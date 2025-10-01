/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    // Explicit internal mappings (avoid catching node_modules paths like react-is)
    '^../../utils/text\.js$': '<rootDir>/src/utils/text.ts',
    '^../../utils/query\\.js$': '<rootDir>/src/utils/query.ts',
    '^../../utils/http\\.js$': '<rootDir>/src/utils/http.ts',
    '^../../utils/contexts\\.js$': '<rootDir>/src/utils/contexts.ts',
  '^../core/constants\\.js$': '<rootDir>/src/core/constants.ts',
  '^../../core/constants\\.js$': '<rootDir>/src/core/constants.ts',
  '^../analysis/scoring\\.js$': '<rootDir>/src/analysis/scoring.ts',
  '^../scoring\\.js$': '<rootDir>/src/analysis/scoring.ts',
  '^\.\/scoring\.js$': '<rootDir>/src/analysis/scoring.ts',
  '^\.\/http\.js$': '<rootDir>/src/utils/http.ts',
    '^../../utils/params\\.js$': '<rootDir>/src/utils/params.ts',
    '^../utils/params\\.js$': '<rootDir>/src/utils/params.ts',
  '^../stores/paramStore\.js$': '<rootDir>/src/stores/paramStore.ts',
  '^../core/types\.js$': '<rootDir>/src/core/types.ts',
  '^../../payload/payloadGenerator\\.js$': '<rootDir>/src/payload/payloadGenerator.ts',
  '^./context\\.js$': '<rootDir>/src/analysis/bodyReflection/context.ts',
  '^./probes\\.js$': '<rootDir>/src/analysis/bodyReflection/probes.ts',
  '^./mergeEncodedSignals\\.js$': '<rootDir>/src/analysis/mergeEncodedSignals.ts',
  '^./contextMap\\.js$': '<rootDir>/src/analysis/contextMap.ts',
  '^../encodedSignalsStore\\.js$': '<rootDir>/src/analysis/encodedSignalsStore.ts',
  '^./probeRunner\\.js$': '<rootDir>/src/analysis/bodyReflection/probeRunner.ts',
  '^./contextResolution\\.js$': '<rootDir>/src/analysis/bodyReflection/contextResolution.ts',
  '^./encodedSignalDetection\\.js$': '<rootDir>/src/analysis/bodyReflection/encodedSignalDetection.ts',
  '^../../stores/errorStore\\.js$': '<rootDir>/src/stores/errorStore.ts',
  '^../../stores/paramStore\\.js$': '<rootDir>/src/stores/paramStore.ts',
  '^../utils/query\\.js$': '<rootDir>/src/utils/query.ts',
  '^./baseTrackedParamStore\.js$': '<rootDir>/src/stores/baseTrackedParamStore.ts',
  '^./trackedParam\.js$': '<rootDir>/src/stores/trackedParam.ts',
  '^../../stores/baseTrackedParamStore\\.js$': '<rootDir>/src/stores/baseTrackedParamStore.ts',
  '^../../stores/trackedParam\\.js$': '<rootDir>/src/stores/trackedParam.ts',
    // Generic: map any .js import in src/ to .ts file
    '^../src/(.*)\.js$': '<rootDir>/src/$1.ts',
    '^../src/(.*)/(.*)\.js$': '<rootDir>/src/$1/$2.ts',
    '^../src/(.*)/(.*)/(.*)\.js$': '<rootDir>/src/$1/$2/$3.ts',
    '^../src/(.*)/(.*)/(.*)/(.*)\.js$': '<rootDir>/src/$1/$2/$3/$4.ts'
  },
  transform: {
    '^.+\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
        diagnostics: true
      }
    ]
  },
  roots: ['<rootDir>/tests'],
  moduleDirectories: ['node_modules', 'src'],
  verbose: true
};