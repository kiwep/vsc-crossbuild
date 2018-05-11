# Change Log

## [0.1.8]
* Variables in the default project config file does not get incorrectly substituted anymore
* Added the `extraLinkerFlags` configuration option

## [0.1.7]
* Fixed: build script now follows symlinks while building file list

## [0.1.6]
* Added: `outFile` option to `postBuildTasks`. If specified the output of the task will be redirected to `outFile`.

## [0.1.5]
* Fixed: missing c_cpp_properties.json file was not generated

## [0.1.4]
* Fixed: there was an issue in cpptools at startup caused by crossbuild rewriting the c_cpp_properties file while it was unchanged
* Added: `crossbuild.vsCCppExtraDefines` config option

## [0.1.3]
* Fixed: for cpptools intergation c_cpp_properties.json now includes the browse.path section

## [0.1.2]
* Fixed: buildfile generation error - the script now flushes the build denition file to disk before running Ninja.

## [0.1.1]
* New configuration options: `nodePath` and `ninjaPath` added

## [0.1.0]
* Initial release with base functionality
