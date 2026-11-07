/** React Doctor (`pnpm run doctor`). Every ignore names its reason; fix findings instead of adding entries here. */
export default {
  ignore: {
    files: ["var/**", "test-results/**", "playwright-report/**", "dist/**", ".output/**", "src/routeTree.gen.ts"],
    overrides: [
      // shadcn/ui keeps its cva variants next to the component, as upstream ships them
      { files: ["src/components/ui/**"], rules: ["react-doctor/only-export-components"] },
      // TanStack Form submits through form.handleSubmit; preventDefault only stops the native page submit
      { files: ["src/components/form/form.tsx"], rules: ["react-doctor/no-prevent-default"] },
    ],
    rules: [
      // cache invalidation runs through shared helpers (useRefreshAbsences, invalidateTimeData, useAction)
      // that the rule cannot follow; every mutation refreshes the queries it touches
      "react-doctor/query-mutation-missing-invalidation",
    ],
  },
}
