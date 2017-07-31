# CrossBuild: C/C++ Build System for Embedded Development

> This extension is exprimental. It works for us, but not yet feature rich or well tested.

CrossBuild is a simple build system based on [Ninja](https://ninja-build.org). It's designed to work with cross-build toolchains like the [GNU ARM Embedded Toolchain](https://developer.arm.com/open-source/gnu-toolchain/gnu-rm) and provide a way to build with these toolchains quickly from inside the Visual Studio Code IDE.

## Requirements

The following packages are required by this extension:

* [Node.js](https://nodejs.org/) 7.6 or newer
* [Ninja](https://ninja-build.org) 1.3 or newer

These tools are milti-platform so you should be able to install these on your system.

## Configuration

From the command palette choose the `CrossBuild: Edit Configurations...` menu item. This will generate a new configuration file in your project if there is none and opens it in the editor.

An example configuration file looks like the following:

```json
{
    "toolchains": {
        "gcc-arm-none-eabi": {
            "root": "${GCC_ARM_PATH}",
            "tools": {
                "AS": "bin/arm-none-eabi-as",
                "CC": "bin/arm-none-eabi-gcc",
                "CXX": "bin/arm-none-eabi-g++",
                "LD": "bin/arm-none-eabi-g++",
                "SIZE": "bin/arm-none-eabi-size"
            }
        }
    },
    "targets": {
        "MyApp": {
            "toolchain": "gcc-arm-none-eabi",
            "productName": "MyApp.elf",
            "sourceRoot": "${workspaceRoot}",
            "configurations": {
                "_default": {
                    "includePaths": [
                        "include",
                        "${toolchainRoot}/arm-none-eabi/include",
                        "${toolchainRoot}/arm-none-eabi/include/c++/${GCC_ARM_VER}",
                        "${toolchainRoot}/arm-none-eabi/include/c++/${GCC_ARM_VER}/arm-none-eabi",
                        "${toolchainRoot}/lib/gcc/arm-none-eabi/${GCC_ARM_VER}/include"
                    ],
                    "ignoreSources": [
                        "**/*_template.c"
                    ],
                    "defines": [
                        "STM32F070xB",
                        "USE_HAL_DRIVER"
                    ],
                    "flags": {
                        "_default": [
                            "-mcpu=cortex-m0",
                            "-mthumb",
                            "-mfloat-abi=soft"
                        ],
                        "CC": [
                            "${inherit:_default}",
                            "-ffunction-sections",
                            "-fdata-sections",
                            "-ffreestanding",
                            "-flto",
                            "-Wall"
                        ],
                        "CXX": [
                            "${inherit:CC}",
                            "-std=gnu++11",
                            "-fno-exceptions",
                            "-fno-rtti"
                        ],
                        "AS": [
                            "${inherit:_default}"
                        ],
                        "LD": [
                            "${inherit:CC}",
                            "-Xlinker --gc-sections",
                            "-lc",
                            "-lm",
                            "--specs=nano.specs",
                            "-TBoard/STM32F070RBTx_FLASH.ld"
                        ]
                    },
                    "postBuildTasks": [
                        {
                            "tool": "SIZE",
                            "args": [ "${productFile}" ]
                        }
                    ]
                },
                "Debug": {
                    "inherit": "_default",
                    "productDir": ".build/Debug",
                    "defines": [
                        "DEBUG",
                        "ENABLE_SEMIHOSTING"
                    ],
                    "flags": {
                        "CC": [
                            "-g",
                            "-Og"
                        ],
                        "LD": [
                            "-lrdimon",
                            "--specs=rdimon.specs"
                        ]
                    }
                },
                "Release": {
                    "inherit": "_default",
                    "productDir": ".build/Release",
                    "flags": {
                        "CC": [
                            "-Os"
                        ]
                    }
                }
            }
        }
    }
}
```

### Parameters in the configuration file

Every string value in the config file is searched for parameters. The format of a parameter is the following: `${NAME}` where name can be an environment variable (like `GCC_ARM_PATH` in this example) or a special named parameter like `${workspaceRoot}` that points to the root of the current workspace directory. There are special parameters supported in certain configuration objects, see below.

### Toolchains section

Define the toolchains you use in the `"toolchains"` object. The `"root"` property can be used later as the `${toolchainRoot}` parameter. In the tools section `CC`, `CXX` and `LD` path definitions are required for compiling C and C++ files and linking these objects. `AS` is required if your project contains Assembly source files. Apart from these you can specify any other tools and use them in the `"postBuildTasks"` section (like `SIZE` in this example).

### Targets section

You can define one or many targets. A target object should have a `"toolchain"`, `"productName"` and `"configurations"` section. The toolchain property is used to set the toolchain used to build the target. The productName is the filename of the product generated by the target. There is an optional `"sourceRoot"` property you can set if your source files are not directly under the project root.

### Configurations

Every target should have at least one configuration. A configuration whose name starts with an underscore (like `_default` in this example) is private and does not show up in the configuration selection list. Private configurations are a simple way to share settings between multiple configurations. You can use the `"inherit"` property in a config definition to specify the parent settings.

The `"includePaths"` array is used to specify the include paths for the compiler. You can use the `${toolchainRoot}` property to refer to files inside your toolchain (system headers for example). The `"defines"` array is self explanatory. These settings are used for generating the `c_cpp_parameters.json` file if integration with `cpptools` is enabled.

CrossBuild includes every .c, .cpp, .cc and .s files from your project by default. You can specify excluded filed and directories in the `"ignoreSources"` array. Every entry is a glob pattern used to filter the sources tree.

The `"flags"` section defines the build flags for every source type. A name starting the an underscore is a private entry used for inheritance (similarly for the configuration names). In any flags section you can include any other section with this special property format: `${inherit:NAME}`. Duplicate entries are NOT filtered.

In the optional `"postBuildTasks"` section you can specify commands to run after a successful build. A `"tool"` from the toolchains definitions or a `"command"` parameter can be used togerther with the `"args"` array to invoke the command. There is a special `${productFile}` parameter availabel in this section that contains the relative path to the target product binary.

## Building with CrossBuild

The expension specifies two tasks: a build and a clean. In a configured project you can invoke these from the `Run Task...` menu. To set CrossBuild the default build command create a `tasks.json` with the following content:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "cross",
      "command": "build",
      "problemMatcher": "$gcc",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    },
    {
      "type": "cross",
      "command": "clean",
      "problemMatcher": []
    }
  ]
}
```

As you can see the extension adds a new `cross` task type and a `$gcc` problem matcher to Visual Studio Code.

## Extension Settings

This extension contributes the following settings:

* `crossbuild.enable`: enable/disable the extension; default is disable so you have to explicitly enable it in the user/workspace setting
* `crossbuild.generateVsCCppProperties`: enable/disable the automatic generation of the `c_cpp_properties.json` file for `cpptools`
* `crossbuild.nodePath`: Path to Node.js binary if the `node` command is not found on your $PATH
* `crossbuild.ninjaPath`: Path to Ninja binary if the `ninja` command is not found on your $PATH

## Known Issues

* Circular references are not checked in the property inheritance implementation
* No error messages on misconfigured config file

## Release Notes

### 0.1.4

Only rewrite c_cpp_properties.json if the file content is different
Added new config option `crossbuild.vsCCppExtraDefines`: an array of extra defines to add to the generated c_cpp_properties file. This is useful if clang needs additional  defines present by default in your toolchains compiler (`__GNUC__` for example)

### 0.1.3

Fixed cpptools intergation: c_cpp_properties.json now includes the browse.path section

### 0.1.2

Fixed a buildfile generation error. Now the script flushes to disk the build denition file before running Ninja.

### 0.1.1

Added the following configuration options:
* nodePath
* ninjaPath

### 0.1.0

Initial release of CrossBuild
