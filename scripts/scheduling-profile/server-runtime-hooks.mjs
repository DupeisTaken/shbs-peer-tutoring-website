/** Select the package's own empty server marker; leave React, Next, Auth.js,
 * application modules and every other package's condition set unchanged. */
export function resolve(specifier, context, nextResolve) {
  if (specifier !== "server-only") return nextResolve(specifier, context);
  return nextResolve(specifier, {
    ...context,
    conditions: [...new Set([...context.conditions, "react-server"])],
  });
}
