const fake = new URL('./fake-firestore.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@google-cloud/firestore') {
    return { url: fake, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
