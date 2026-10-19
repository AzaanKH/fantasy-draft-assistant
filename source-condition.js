export const sourceCondition = {
  resolve: {
    conditions: ['module', 'browser', 'development|production', '@fantasy-draft/source'],
  },
  ssr: {
    resolve: {
      conditions: ['module', 'node', 'development|production', '@fantasy-draft/source'],
    },
  },
};
