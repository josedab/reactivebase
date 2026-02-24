export {
  SearchQueryBuilder,
  SearchError,
  generateSearchIndexSQL,
  generateFacetSQL,
  createSearchQuery,
  searchTable,
} from "./full-text-search.js"
export type {
  SearchableColumnConfig,
  SearchOptions,
  FuzzySearchOptions,
  HighlightOptions,
  FacetConfig,
  FacetResult,
  SearchResult,
  SearchIndexDefinition,
  SearchQueryPlan,
  SearchLanguage,
  FuzzyMatchType,
  SearchRankFunction,
  SearchableValidatorOptions,
} from "./full-text-search.js"
