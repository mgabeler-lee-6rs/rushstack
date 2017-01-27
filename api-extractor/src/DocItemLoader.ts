import * as fsx from 'fs-extra';
import * as os  from 'os';
import * as path from 'path';
import { IDocItem, IDocPackage, IDocClass } from './IDocItem';
import { IApiDefinitionReference } from './IApiDefinitionReference';
import JsonFile from './JsonFile';

/**
 * Used to describe a parsed package name in the form of
 * scopedName/packageName. Ex: @microsoft/sp-core-library.
 */
export interface IParsedScopeName {
  /**
   * The scope prefix. Ex: @microsoft.
   */
  scope: string;

  /**
   * The specific package name. Ex: sp-core-library.
   */
  name: string;
}

/**
 * A loader for locating the IDocItem associated with a given project and API item.
 * The DocItem loader utilizes the json files generated by the API-Extractor ApiJsonGenerator.
 * The IDocItem can then be used to enforce correct API usage, like enforcing internal.
 * To use to DocItemLoader: provide a projectFolder to construct a instance of the DocItemLoader,
 * then use DocItemLoader.getItem to retrieve the IDocItem of a particular API item.
 */
export default class DocItemLoader {
  private _cache: Map<string, IDocPackage>;
  private _projectFolder: string; // Root directory to check for node modules
  private _errorHandler: (message: string) => void;

  /**
   * The projectFolder is the top-level folder containing package.json for a project
   * that we are compiling.
   */
  constructor(projectFolder: string) {
    if (!fsx.existsSync(path.join(projectFolder, 'package.json'))) {
      throw new Error(`An NPM project was not found in the specified folder: ${projectFolder}`);
    }

    this._projectFolder = projectFolder;
    this._cache = new Map<string, IDocPackage>();
  }

  /**
   * Attempts to retrieve an API item from the provided apiDefinitionRef.
   * First checks the cache for the package, if not in the cache then the method
   * will attempt to the locate the associated json file to load the package and
   * check there. If the API item can not be found the method will return undefined.
   */
  public getItem(apiDefinitionRef: IApiDefinitionReference, reportError: (message: string) => void): IDocItem {
    if (!apiDefinitionRef) {
      reportError('Expected reference within {@inheritdoc} tag');
      return undefined;
    }
    // Try to load the package given the provided packageName into the cache
    const docPackage: IDocPackage =  this.getPackage(apiDefinitionRef, reportError);

    // Check if package was not found
    if (!docPackage) {
      return undefined;
    }

    if (apiDefinitionRef.exportName in docPackage.exports) {
      let docItem: IDocItem = docPackage.exports[apiDefinitionRef.exportName];

      // If memberName exists then check for the existense of the name
      if (apiDefinitionRef.memberName) {
        if ( apiDefinitionRef.memberName in (docItem as IDocClass).members) {
          docItem = (docItem as IDocClass).members[apiDefinitionRef.memberName];
        } else {
          // member name was not found, apiDefinitionRef is invalid
          return undefined;
        }
      }

      // Correct doc item was found
      return docItem;
    } else {
      // Not found
      return undefined;
    }
  }

  /**
   * Attempts to locate and load the IDocPackage object from the project folder's
   * node modules. If the package already exists in the cache, nothing is done.
   *
   * @param apiDefinitionRef - interface with propropties pertaining to the API definition reference
   */
  public getPackage(apiDefinitionRef: IApiDefinitionReference, reportError: (message: string) => void): IDocPackage {
    let cachePackageName: string = '';

    // We concatenate the scopeName and packageName in case there are packageName conflicts
    if (apiDefinitionRef.scopeName) {
      cachePackageName = `${apiDefinitionRef.scopeName}/${apiDefinitionRef.packageName}`;
    } else {
      cachePackageName = apiDefinitionRef.packageName;
    }
    // Check if package exists in cache
    if (this._cache.has(cachePackageName)) {
        return this._cache.get(cachePackageName);
    }

    if (!apiDefinitionRef.packageName) {
      // Local export resolution is currently not supported yet
      return;
    }

    // Doesn't exist in cache, attempt to load the json file
    const packageJsonFilePath: string =  path.join(
      this._projectFolder,
      'node_modules',
      apiDefinitionRef.scopeName,
      apiDefinitionRef.packageName,
      `dist/${apiDefinitionRef.packageName}.api.json`
    );

    if (!fsx.existsSync(path.join(packageJsonFilePath))) {
      // package not found in node_modules
      reportError(`@inheritdoc referenced package ("${apiDefinitionRef.packageName}") not found in node modules.`);
      return;
    }

    return this.loadPackageIntoCache(packageJsonFilePath);
  }

  /**
   * Loads the API documentation json file and validates that it conforms to our schema. If it does, 
   * then the json file is saved in the cache and returned.
   */
  public loadPackageIntoCache(packageJsonFilePath: string): IDocPackage {
    const apiPackage: IDocPackage = JsonFile.loadJsonFile(packageJsonFilePath) as IDocPackage;

    // Validate that the output conforms to our JSON schema
    const apiJsonSchema: { } = JsonFile.loadJsonFile(path.join(__dirname, './schemas/api-json-schema.json'));
    JsonFile.validateSchema(apiPackage, apiJsonSchema,
      (errorDetail: string): void => {
        const errorMessage: string
          = `ApiJsonGenerator validation error - output does not conform to api-json-schema.json:` + os.EOL
          + errorDetail;

        console.log(os.EOL + 'ERROR: ' + errorMessage + os.EOL + os.EOL);
        throw new Error(errorMessage);
      }
    );

    const packageName: string = path.basename(packageJsonFilePath).split('.').shift();
    this._cache.set(packageName, apiPackage);
    return apiPackage;
  }
}