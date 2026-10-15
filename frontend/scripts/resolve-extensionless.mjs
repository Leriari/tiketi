// Node ESM loader hook, used only by measure-offline-accuracy.mjs.
//
// validate.js imports totp.js/credentialStore.js without a file extension
// (`from "./totp"`) — fine under Vite/Vitest's own resolver, which this
// project's test suite already relies on, but plain `node` requires exact
// specifiers. validate.js cannot be edited to add the extension (Work
// Order 05 rule 3: do not modify it), so this loader does the one thing
// needed instead of pulling in vite-node as a new dependency for it.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
