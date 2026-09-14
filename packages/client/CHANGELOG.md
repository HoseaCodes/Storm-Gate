# @storm-gate/client

## 0.1.1

### Patch Changes

- 425184a: Fix TypeScript types resolution for CommonJS consumers.

  Both packages declared a single top-level `exports["."].types` pointing at
  `./dist/index.d.ts`. Because each package is `"type": "module"`, that
  declaration file is interpreted as ESM even when resolved through the
  `require` condition, so a TypeScript consumer on `moduleResolution: node16`
  or `bundler` using `require('@storm-gate/express')` got types that only
  worked under dynamic `import()`.

  The `exports` map now nests `types` under each of the `import` and `require`
  conditions, pointing `require` at the `./dist/index.d.cts` file tsup was
  already emitting. Runtime resolution is unchanged — this only affects which
  declaration file a type checker picks up.

  Verified with `publint --strict` and `attw --pack`, which now pass for
  node10, node16 (from CJS), node16 (from ESM), and bundler.
