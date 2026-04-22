/**
 * US Census Bureau ACS 5-Year API config.
 *
 * Free tier, no per-request cost. Same key already used in
 * mpa-homepage/list-builder — published to the browser there, so
 * not secret.
 *
 * The ACS dataset updates annually. We pin the year here so changes
 * require an intentional bump.
 */
export const CENSUS_API_KEY = '127e7c9f9de678f835a5d13a7429f2a7b030ad94';

/** ACS dataset year. Bump when the next year's data is released. */
export const CENSUS_ACS_YEAR = 2022;

/** Base URL for ACS 5-Year endpoint. */
export const CENSUS_ACS_BASE = `https://api.census.gov/data/${CENSUS_ACS_YEAR}/acs/acs5`;

/**
 * Variables we pull per ZIP. Only `B19013_001E` (median household
 * income) is used by the EDDM tool today — the others are reserved
 * for future demographic filters so we don't have to refactor the
 * cache shape when we want to add them.
 */
export const CENSUS_VARS = {
  MEDIAN_INCOME: 'B19013_001E',
  HOUSEHOLDS:   'B25002_002E',
  OWNER_OCC:    'B25003_002E',
  MEDIAN_AGE:   'B01002_001E',
};
