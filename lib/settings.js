/*
   Copyright 2019 Locomote.sh

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

/**
 * A class for accessing system settings.
 */
class Settings {

    constructor( settings ) {
        this._settings = settings;
    }

    /**
     * Get the setting referenced by a dotted path.
     * @param A dotted configuration path, e.g. 'aaa.bbb.ccc'.
     * @return The setting value at the specified path, or the default
     * value if no value in the settings.
     */
    get( path, defaultValue ) {
        path = path.split('.');
        let value = path.reduce( ( value, id ) => {
            return value !== undefined ? value[id] : undefined;
        }, this._settings );
        if( value === undefined ) {
            value = defaultValue;
        }
        return value;
    }

    /**
     * Get the settings referenced by a dotted path.
     * @param A dotted configuration path, e.g. 'aaa.bbb.ccc'.
     * @return The setting value at the specified path as a Settings object,
     * or the default value if no value in the settings.
     */
    settings( path, defaultValue ) {
        let value = this.get( path, defaultValue );
        if( typeof value === 'object' && !Array.isArray( value ) ) {
            value = new Settings( value );
        }
        return value;
    }

    /**
     * Get the setting referenced by a dotted path as a path.
     * @param A dotted configuration path, e.g. 'aaa.bbb.ccc'.
     * @return The setting value at the specified path; ensures that there is
     * a trailing slash at the end of the value.
     */
    path( path, defaultValue ) {
        let value = this.get( path, defaultValue );
        if( typeof value === 'string' && value[value.length - 1] != '/' ) {
            value += '/';
        }
        return value;
    }

    /**
     * Merge additional settings over the current settings.
     * Settings are organized into three levels:
     * - category
     * - sub-category
     * - setting
     * Category and sub-category levels are merged, whilst setting levels from
     * the additional settings overwrite the current settings.
     */
    merge( additional ) {
        const { _settings } = this;
        for( const categoryName in additional ) {
            const category = additional[categoryName];
            const _category = _settings[categoryName];
            if( _category && typeof _category === 'object' ) {
                for( const subCategoryName in category ) {
                    const subCategory = category[subCategoryName];
                    const _subCategory = _category[subCategoryName];
                    if( _subCategory && typeof _subCategory === 'object' ) {
                        _category[subCategoryName] = Object.assign(
                            _subCategory,
                            subCategory
                        );
                    }
                    else _category[subCategoryName] = subCategory;
                }
            }
            else _settings[categoryName] = category;
        }
    }
}

exports.Settings = Settings;

