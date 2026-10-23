// upkit's Linker reads packages from folders with node:fs. In the browser it
// is given no folders (the site hands it the packages it read), so these are
// never reached; they stand in so upkit's code bundles and type-checks in the
// site (vite.config.ts, tsconfig.app.json).
export const existsSync = (_path: string): boolean => false
export const readdirSync = (_dir: string): string[] => []
export const readFileSync = (_path: string): never => {
  throw new Error('no files to read in the browser')
}
