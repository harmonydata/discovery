"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Box, Container, TextField, Button, Typography, Pagination, Drawer, IconButton, useMediaQuery, useTheme } from "@mui/material";
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import CloseIcon from '@mui/icons-material/Close';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import Image from "next/image";
import SearchResults from "@/components/SearchResults";
import FilterPanel from "@/components/FilterPanel";
import StudyDetail from "@/components/StudyDetail";
import {
  fetchSearchResults,
  fetchAggregateFilters,
  fetchResultByUuid,
  SearchResponse,
  SearchResult,
  AggregateFilter,
} from "@/services/api";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";


// Create a new component for the search functionality
function DiscoverPageContent() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg')); // 1200px breakpoint
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filters, setFilters] = useState<AggregateFilter[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(false);
  const [totalHits, setTotalHits] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDebug, setShowDebug] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [apiOffline, setApiOffline] = useState(false);
  const resultsPerPage = 20; // Page size for the API
  
  const searchParams = useSearchParams();
  const resourceType = searchParams.get("resource_type");
  const resourceTypeFilter = useMemo(
    () => (resourceType ? [resourceType] : []),
    [resourceType]
  );

  // Debounce search query to prevent firing API calls on every keystroke
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500); // 500ms delay after user stops typing
    
    return () => {
      clearTimeout(timerId);
    };
  }, [searchQuery]);

  // Debug helper function to log current state to console
  const debugState = useCallback(() => {
    // Store state in window for later inspection
    if (typeof window !== 'undefined') {
      // @ts-ignore - Adding debug properties to window
      window.__debugState = {
        // currentPage,
        currentPage,
        totalHits,
        resultsPerPage,
        searchQuery,
        debouncedSearchQuery,
        selectedFilters,
        filters,
        results,
        selectedResult,
        apiOffline
      };
      
      console.log('Current state stored in window.__debugState');
      console.log('Current state:', {
        pagination: { 
          // currentPage, 
          currentPage,
          totalHits, 
          resultsPerPage, 
          totalPages: Math.ceil(totalHits / resultsPerPage)
        },
        searchQuery,
        debouncedSearchQuery,
        selectedFilters,
        filterCount: filters.length,
        resultCount: results.length,
        selectedResult: selectedResult ? {
          id: selectedResult.extra_data?.uuid,
          title: selectedResult.dataset_schema?.name
        } : null,
        apiOffline
      });
    }
  }, [
    // currentPage, 
    currentPage,
    totalHits, resultsPerPage, searchQuery, debouncedSearchQuery, selectedFilters, filters, results, selectedResult, apiOffline
  ]);

  // Handle result selection
  const handleSelectResult = useCallback((result: SearchResult) => {
    console.log('Selected result:', result);
    setSelectedResult(result);
    // Open drawer on mobile when a result is selected
    if (isMobile) {
      setDrawerOpen(true);
    }
  }, [isMobile]);

  // Function to close the drawer
  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // Toggle debug panel
  const toggleDebug = useCallback(() => {
    setShowDebug(prev => !prev);
    debugState();
  }, [debugState]);

  // Debug event to prevent console clearing
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const preserveLog = (e: Event) => {
        if (e.target === window) {
          console.log('Preserving console log');
          e.stopPropagation();
          return false;
        }
        return true;
      };
      
      window.addEventListener('beforeunload', preserveLog, true);
      
      return () => {
        window.removeEventListener('beforeunload', preserveLog, true);
      };
    }
  }, []);

  // Fetch initial aggregations for filters - this should only happen once
  useEffect(() => {
    async function fetchInitialAggregations() {
      try {
        console.log("Fetching initial aggregations...");
        setLoading(true);
        setApiOffline(false);
        
        // Create a promise that rejects after a timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('API request timed out')), 60000); // 60 seconds timeout
        });
        
        // Race the actual API call against the timeout
        const aggregateData = await Promise.race([
          fetchAggregateFilters(),
          timeoutPromise
        ]);
        
        const processedFilters = processAggregations(aggregateData);
        setFilters(processedFilters);
        console.log("Initial aggregations set:", processedFilters.length, "filters");
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch initial aggregations:", error);
        setApiOffline(true);
        setLoading(false);
      }
    }
    
    fetchInitialAggregations();
  }, []);

  // Select the first result by default after search
  useEffect(() => {
    if (results.length > 0 && !selectedResult) {
      setSelectedResult(results[0]);
    } else if (results.length > 0 && selectedResult) {
      // If current selection is no longer in results, select the first result
      const stillExists = results.some(result => result.extra_data?.uuid === selectedResult.extra_data?.uuid);
      if (!stillExists) {
        setSelectedResult(results[0]);
      }
    } else if (results.length === 0) {
      setSelectedResult(null);
    }
  }, [results, selectedResult]);

  // Convert SearchResult to StudyDetail format
  // This needs to be defined *before* studyDetailForDisplay which uses it
  const mapResultToStudyDetail = useCallback(async (result: SearchResult) => {
    const isVariableResult = result.extra_data?.resource_type?.includes('variable');
    const hasAncestors = Array.isArray(result.ancestors) && result.ancestors.length > 0;
    const displayResult = (isVariableResult && hasAncestors && result.ancestors?.[0]) || result;
    const needsLookup = displayResult.extra_data?.number_of_variables && !displayResult.dataset_schema?.variableMeasured?.length;

    if (needsLookup) {
      const fullyPopulatedResult = await fetchResultByUuid(displayResult.extra_data?.uuid || '');
      if(isVariableResult) {
        const varibleResult = {
          uuid: result.extra_data?.uuid,
          name: result.extra_data?.name || 'Unnamed Variable',
          description: result.extra_data?.description
        }
        fullyPopulatedResult.variables_which_matched = [
           varibleResult
        ];
      }
      return mapResultToStudyDetail(fullyPopulatedResult);
    }
    // Extract data from result
    const title = displayResult.dataset_schema?.name || "Untitled Dataset";
    const description = displayResult.dataset_schema?.description || "";
    
    // Extract image - using type assertion to handle possible undefined
    const image = (displayResult.dataset_schema as any)?.image || (displayResult as any).image || undefined;
    
    // Extract publisher with type safety
    let publisher: { name: string; url?: string; logo?: string } | undefined = undefined;
    if (displayResult.dataset_schema?.publisher?.[0]?.name) {
      publisher = {
        name: displayResult.dataset_schema.publisher[0].name,
        url: (displayResult.dataset_schema.publisher[0] as any)?.url,
        logo: (displayResult.dataset_schema.publisher[0] as any)?.logo,
      };
    }
    
    // Extract funders with type safety - handling both array and space-delimited string formats
    let funders: Array<{ name: string; url?: string; logo?: string }> | undefined = undefined;
    
    // Check if this is from the Catalogue of Mental Health
    const isFromCMHM = displayResult.dataset_schema?.includedInDataCatalog?.some(
      catalog => catalog.name?.includes("Mental Health") || catalog.name?.includes("CMHM")
    );
    
    // Additional check for catalogues that might have similar funder formats
    const hasMentalHealthTopics = (displayResult as any).topics?.some((topic: string) => 
      topic.toLowerCase().includes("mental health") || 
      topic.toLowerCase().includes("psychiatry") || 
      topic.toLowerCase().includes("psychology")
    );
    
    // console.log("Is from CMHM:", isFromCMHM, "Has mental health topics:", hasMentalHealthTopics);
    
    // Helper function to detect if a string appears to be a space-delimited list of abbreviations
    const isAbbreviationList = (str: string): boolean => {
      // If it has spaces and no commas or semicolons, it might be a list
      if (!str.includes(' ') || /[,.;]/.test(str)) return false;
      
      // Split by spaces and check if parts look like abbreviations
      const parts = str.split(' ').map(p => p.trim()).filter(p => p.length > 0);
      
      // Is each part likely to be an abbreviation?
      // Check if most parts are short (<=8 chars) or contain uppercase characters
      const abbreviationCount = parts.filter(part => 
        part.length <= 8 || 
        part.toUpperCase() === part || 
        /[A-Z]{2,}/.test(part)
      ).length;
      
      // If most parts (>60%) look like abbreviations, consider it an abbreviation list
      return abbreviationCount / parts.length > 0.6;
    };
    
    // First check if we have funders as an array in dataset_schema
    if (displayResult.dataset_schema?.funder && Array.isArray(displayResult.dataset_schema.funder) && displayResult.dataset_schema.funder.length > 0) {
      // console.log("Processing funders from dataset_schema.funder array:", displayResult.dataset_schema.funder);
      funders = displayResult.dataset_schema.funder.map(funder => ({
        name: funder.name || "Funding Organization",
        url: (funder as any)?.url,
        logo: (funder as any)?.logo,
      }));
    } 
    // Then check for funders as a property in the result or extra_data
    else if ((displayResult as any).funders || (displayResult.extra_data as any)?.funders) {
      const resultFunders = (displayResult as any).funders || (displayResult.extra_data as any)?.funders;
      // console.log("Processing funders from result.funders or extra_data.funders:", resultFunders);
      
      if (Array.isArray(resultFunders)) {
        // Handle array of funders
        funders = resultFunders.map(funder => {
          if (typeof funder === 'string') {
            return { name: funder };
          } else if (typeof funder === 'object' && funder !== null) {
            return {
              name: funder.name || "Funding Organization",
              url: funder.url,
              logo: funder.logo,
            };
          }
          return { name: String(funder) };
        });
      } else if (typeof resultFunders === 'string') {
        // Handle string of funders (potentially space-delimited)
        if (resultFunders.trim()) {
          // For Catalogue of Mental Health or strings that look like abbreviation lists, 
          // split by spaces and treat each part as a separate funder
          if ((isFromCMHM || hasMentalHealthTopics || isAbbreviationList(resultFunders)) && 
              resultFunders.includes(' ')) {
            // console.log("Processing potential abbreviation list:", resultFunders);
            // Split the space-delimited list into individual abbreviations
            const funderAbbreviations = resultFunders.split(' ')
              .map(part => part.trim())
              .filter(part => part.length > 0);
            
            // console.log("Split into abbreviations:", funderAbbreviations);
            
            // Create a separate funder entry for each abbreviation
            funders = funderAbbreviations.map(abbr => ({ 
              name: abbr
            }));
          }
          // For other sources, check if it's a space-delimited list without punctuation
          else if (resultFunders.includes(' ') && !/[,.;]/.test(resultFunders)) {
            const funderNames = resultFunders.split(' ').filter(part => part.trim().length > 0);
            funders = funderNames.map(name => ({ name }));
          } else {
            // Just use the string as a single funder name
            funders = [{ name: resultFunders }];
          }
        }
      }
    }
    
    // Try more checks for CMHM-specific funders if we still don't have any
    if ((!funders || funders.length === 0) || (isFromCMHM || hasMentalHealthTopics)) {
      // Check various fields that might contain funder information
      const possibleFunderFields = [
        (displayResult as any).cmhm_funders,
        (displayResult.extra_data as any)?.cmhm_funders,
        (displayResult as any).funding_bodies,
        (displayResult.extra_data as any)?.funding_bodies,
        (displayResult as any).funding,
        (displayResult.extra_data as any)?.funding,
        (displayResult as any).funder,
        (displayResult.extra_data as any)?.funder
      ];
      
      // Find the first non-empty field
      const additionalFunders = possibleFunderFields.find(field => field !== undefined && field !== null);
      
      if (additionalFunders) {
        // console.log("Found additional funders in alternative field:", additionalFunders);
        
        let newFunders: Array<{ name: string; url?: string; logo?: string }> = [];
        
        if (typeof additionalFunders === 'string' && additionalFunders.trim()) {
          // If it looks like an abbreviation list, split it
          if (isAbbreviationList(additionalFunders)) {
            const funderAbbreviations = additionalFunders.split(' ')
              .map(part => part.trim())
              .filter(part => part.length > 0);
            
            newFunders = funderAbbreviations.map(abbr => ({ name: abbr }));
          } else {
            // Just use the string as a single funder name
            newFunders = [{ name: additionalFunders }];
          }
        } else if (Array.isArray(additionalFunders)) {
          newFunders = additionalFunders.map(funder => 
            typeof funder === 'string' ? { name: funder } : { 
              name: funder.name || String(funder),
              url: funder.url,
              logo: funder.logo
            }
          );
        }
        
        // If we already had funders, merge with new ones, otherwise use new ones
        if (funders && funders.length > 0) {
          // console.log("Merging with existing funders");
          // Merge but avoid duplicates
          const existingNames = new Set(funders.map(f => f.name));
          const uniqueNewFunders = newFunders.filter(f => !existingNames.has(f.name));
          funders = [...funders, ...uniqueNewFunders];
        } else {
          funders = newFunders;
        }
      }
    }
    
    // Handle special case for raw funder string when we couldn't parse it previously
    if ((!funders || funders.length === 1) && funders?.[0]?.name && isAbbreviationList(funders[0].name)) {
      // console.log("Re-processing single funder that looks like an abbreviation list:", funders[0].name);
      
      const funderAbbreviations = funders[0].name.split(' ')
        .map(part => part.trim())
        .filter(part => part.length > 0);
      
      funders = funderAbbreviations.map(abbr => ({ name: abbr }));
    }
    
    // Geographic coverage
    const geographicCoverage = (displayResult as any).geographic_coverage || 
                              (displayResult.extra_data?.country_codes?.join(", ") || 
                               (displayResult as any).country_codes?.join(", ")) || 
                              undefined;
    
    // Temporal coverage (from dataset_schema or start/end years)
    const temporalCoverage = displayResult.dataset_schema?.temporalCoverage || 
                          ((displayResult as any).start_year && 
                           `${(displayResult as any).start_year}${(displayResult as any).end_year ? `..${(displayResult as any).end_year}` : ''}`);
    
    // Sample size
    const sampleSize = (displayResult as any).sample_size?.toString() || 
                    ((displayResult.dataset_schema as any)?.size?.toString()) || 
                    undefined;
    
    // Age coverage
    const ageLower = displayResult.extra_data?.age_lower || (displayResult as any).age_lower;
    const ageUpper = displayResult.extra_data?.age_upper || (displayResult as any).age_upper;
    const ageCoverage = (ageLower !== undefined && ageUpper !== undefined) 
                      ? `${ageLower} - ${ageUpper} years` 
                      : (ageLower !== undefined 
                         ? `${ageLower}+ years`
                         : (ageUpper !== undefined 
                            ? `0 - ${ageUpper} years`
                            : undefined));
    
    // Study design
    const studyDesign = displayResult.extra_data?.study_design || (displayResult as any).study_design || [];
    
    // Resource type
    const resourceType = displayResult.extra_data?.resource_type || displayResult.dataset_schema?.["@type"] || undefined;
    
    // Topics and instruments
    const unfilteredTopics = displayResult.dataset_schema?.keywords || 
                  (displayResult as any).topics || 
                  [];
    
    // Filter out malformed keywords/topics that contain HTML fragments
    const topics = unfilteredTopics.filter(
      (topic: any) => typeof topic === 'string' && !topic.includes('<a title=') && !topic.startsWith('<')
    );
    
    const instruments = (displayResult as any).instruments || [];
    
    // Extract variables that matched the search query
    const matchedVariables = displayResult.variables_which_matched || [];
    
    // Extract all variables from dataset schema
    const allVariables = displayResult.dataset_schema?.variableMeasured || [];
    
    // Data catalogs from includedInDataCatalog
    let dataCatalogs: Array<{ name: string; url?: string; logo?: string }> | undefined;
    
    // Keep track of all URLs that are already linked via dataCatalogs
    const usedUrls = new Set<string>();
    
    if (displayResult.dataset_schema?.includedInDataCatalog && displayResult.dataset_schema.includedInDataCatalog.length > 0) {
      // Get dataset URLs if available
      const datasetUrls = displayResult.dataset_schema.url || [];
      
      dataCatalogs = displayResult.dataset_schema.includedInDataCatalog.map(catalog => {
        let catalogUrl = catalog.url;
        
        // Check if there's a more specific URL in the dataset's URL array that matches this catalog
        if (Array.isArray(datasetUrls) && catalogUrl) {
          try {
            // Extract the catalog domain
            const catalogDomain = new URL(catalogUrl).hostname;
            
            // Find a URL in datasetUrls that has the same domain
            const matchingUrl = datasetUrls.find(urlStr => {
              try {
                const urlDomain = new URL(urlStr).hostname;
                return urlDomain === catalogDomain;
              } catch (e) {
                return false;
              }
            });
            
            // If found a matching URL, use that instead
            if (matchingUrl) {
              catalogUrl = matchingUrl;
            }
          } catch (e) {
            // If URL parsing fails, just use the original catalog URL
            console.warn("Failed to parse catalog URL", e);
          }
        }
        
        // Add to used URLs set
        if (catalogUrl) {
          usedUrls.add(catalogUrl);
        }
        
        return {
          name: catalog.name || 'Data Catalog',
          url: catalogUrl || undefined,
          logo: catalog.image, // Fallback to a default logo
        };
      });
    }
    
    // Extract additional URLs from identifiers and url fields that aren't already covered by data catalogs
    let additionalLinks: string[] = [];
    
    // Process identifiers (URLs to papers, DOIs, etc.)
    if (displayResult.dataset_schema?.identifier && Array.isArray(displayResult.dataset_schema.identifier)) {
      // Filter valid URLs and DOIs
      const validUrls = displayResult.dataset_schema.identifier.filter(id => {
        // Check if it's a URL
        if (id.startsWith('http://') || id.startsWith('https://')) {
          return true;
        }
        // Check if it's a DOI
        if (id.startsWith('10.') && id.includes('/')) {
          return true;
        }
        return false;
      }).map(id => {
        // Convert DOIs to URLs if needed
        if (id.startsWith('10.') && id.includes('/')) {
          return `https://doi.org/${id}`;
        }
        return id;
      });
      
      // Filter out URLs that are already in dataCatalogs
      additionalLinks = [...additionalLinks, ...validUrls.filter(url => !usedUrls.has(url))];
    }
    
    // Process direct URL field
    if (displayResult.dataset_schema?.url && Array.isArray(displayResult.dataset_schema.url)) {
      // Filter out URLs that are already in dataCatalogs
      const newUrls = displayResult.dataset_schema.url.filter(url => !usedUrls.has(url));
      additionalLinks = [...additionalLinks, ...newUrls];
    }
    
    // Add any other potential URL fields
    const otherUrlFields = [
      (displayResult as any).url,
      (displayResult as any).original_source_url,
      (displayResult as any).doi?.startsWith('10.') ? `https://doi.org/${(displayResult as any).doi}` : null
    ].filter(Boolean) as string[];
    
    // Add these URLs if they're not already included
    otherUrlFields.forEach(url => {
      if (url && !usedUrls.has(url) && !additionalLinks.includes(url)) {
        additionalLinks.push(url);
      }
    });
    
    // Ensure we have unique URLs
    additionalLinks = Array.from(new Set(additionalLinks));
    
    // console.log("Additional links found:", additionalLinks);
    
    return {
      title,
      description,
      image,
      publisher,
      funders,
      geographicCoverage,
      temporalCoverage,
      sampleSize,
      ageCoverage,
      studyDesign,
      resourceType,
      topics,
      instruments,
      dataCatalogs,
      matchedVariables,
      allVariables,
      additionalLinks,
    };
  }, []);

  // Memoize the detailed study data derived from the selected result
  const studyDetailForDisplay = useMemo(() => {
    if (!selectedResult) return null;
    // We'll handle the async call in the component that uses this
    return mapResultToStudyDetail(selectedResult);
  }, [selectedResult, mapResultToStudyDetail]);

  // Update the StudyDetail component to handle the async result
  interface StudyDetailData {
    title: string;
    description: string;
    image?: string;
    dataOwner?: { name: string; logo: string; };
    publisher?: { name: string; url?: string; logo?: string; };
    funders?: Array<{ name: string; url?: string; logo?: string; }>;
    geographicCoverage?: string;
    temporalCoverage?: string;
    sampleSize?: string;
    ageCoverage?: string;
    studyDesign?: string[];
    resourceType?: string;
    topics: string[];
    instruments: string[];
    dataCatalogs?: Array<{ name: string; url?: string; logo?: string; }>;
    matchedVariables?: Array<{ name: string; description?: string; }>;
    allVariables?: Array<{ name: string; description?: string; }>;
    additionalLinks?: string[];
  }

  const [studyDetail, setStudyDetail] = useState<StudyDetailData | null>(null);

  useEffect(() => {
    if (studyDetailForDisplay) {
      studyDetailForDisplay.then(result => {
        if (result) {
          setStudyDetail(result);
        }
      });
    } else {
      setStudyDetail(null);
    }
  }, [studyDetailForDisplay]);

  // Re-enabled page change handler
  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setCurrentPage(value);
    // This will trigger the search effect with the new page via the useEffect hook below
  };

  // Effect to trigger search when query, filters, or page changes
  useEffect(() => {
    // Reset to page 1 if query or filters change, but not if only page changes
    const isQueryOrFilterChange = debouncedSearchQuery !== searchQueryRef.current || JSON.stringify(selectedFilters) !== filtersRef.current;
    if (isQueryOrFilterChange && currentPage !== 1) {
      setCurrentPage(1);
      // Store the current query and filters for the next comparison
      searchQueryRef.current = debouncedSearchQuery;
      filtersRef.current = JSON.stringify(selectedFilters);
      // Don't perform search yet, wait for the state update cycle with page 1
      return; 
    }
    
    // Store the current query and filters for the next comparison *after* potential reset check
    searchQueryRef.current = debouncedSearchQuery;
    filtersRef.current = JSON.stringify(selectedFilters);

    performSearch();
    // Dependency array includes query, filters, and page
  }, [debouncedSearchQuery, selectedFilters, currentPage]); // Added currentPage back

  // Refs to track previous query and filters for page reset logic
  const searchQueryRef = useRef(debouncedSearchQuery);
  const filtersRef = useRef(JSON.stringify(selectedFilters));

  async function performSearch() {
    setLoading(true);
    setApiOffline(false);
    try {
      // Create a copy of the filters to send to the API
      const combinedFilters = { ...selectedFilters };
      
      // Add resource_type filter if present in URL params
      if (resourceType) {
        combinedFilters.resource_type = [resourceType];
      }
      
      // Remove any empty filter arrays since they're unnecessary
      Object.keys(combinedFilters).forEach(key => {
        if (Array.isArray(combinedFilters[key]) && combinedFilters[key].length === 0) {
          delete combinedFilters[key];
        }
      });

      // Create a request ID for tracking this particular search request
      const requestId = `search-${Date.now()}`;
      console.group(`🔍 Search Request: ${requestId}`);
      console.log('Search query:', debouncedSearchQuery || '(empty)');
      console.log('Filters:', combinedFilters);
      console.log('Results per page:', resultsPerPage);
      // console.log('Page:', currentPage, 'Results per page:', resultsPerPage);
      
      // Create a promise that rejects after a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('API request timed out')), 60000); // 60 seconds timeout
      });
      
      // Race the actual API call against the timeout
      const res: SearchResponse = await Promise.race([
        fetchSearchResults(
          debouncedSearchQuery,
          combinedFilters,
          // currentPage,
          currentPage,
          resultsPerPage
        ),
        timeoutPromise
      ]);
      
      // Log the response in a way that keeps it in the console
      console.log('Response received:', {
        requestId,
        numHits: res.num_hits,
        resultCount: res.results?.length || 0,
        // Use specific result properties that won't be too verbose
        results: res.results?.map(r => ({
          id: r.extra_data?.uuid, 
          title: r.dataset_schema?.name, 
          type: r.extra_data?.resource_type || r.dataset_schema?.["@type"],
          similarity: r.cosine_similarity
        })),
        timestamp: new Date().toISOString()
      });
      console.groupEnd();
      
      // Set results from the API response
      setResults(res.results || []);
      
      // Set total hits for pagination
      setTotalHits(res.num_hits || 0);
      
      // IMPORTANT: We do NOT update filters based on search results
      // This ensures filters remain stable and consistent during search
    } catch (error) {
      console.error("Search failed:", error);
      setApiOffline(true);
    } finally {
      setLoading(false);
    }
  }

  // Helper function to handle filter selection from FilterPanel
  const handleFilterSelection = (category: string, selectedOptions: string[]) => {
    // Just update the selected filters - the special case of age_range is handled in FilterPanel
    setSelectedFilters(prev => ({
      ...prev,
      [category]: selectedOptions
    }));
  };

  // Helper function to capitalize filter labels
  function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
  }

  // Process aggregations to create filters - this should only be called with initial aggregation data
  const processAggregations = (aggs: Record<string, any>): AggregateFilter[] => {
    const aggregateFilters: AggregateFilter[] = [];

    // Define fields that should use range sliders
    const numericFields = [
      "sample_size",
      "age_lower",
      "age_upper",
      "start_year",
      "end_year",
      "duration_years",
      "num_variables",
      "num_sweeps",
    ];

    // Create a special combined age_range filter from age_lower and age_upper
    let ageMinValue = Infinity;
    let ageMaxValue = -Infinity;

    // Process each aggregation
    Object.entries(aggs).forEach(([field, data]) => {
      // Special handling for age fields to create combined filter
      if (field === "age_lower" || field === "age_upper" || field === "age_min" || field === "age_max") {
        const stats = data.statistics || {};
        
        // Extract min/max, handling possible different property names
        let minStat = stats.minimum;
        if (typeof minStat !== 'number' || !isFinite(minStat)) {
          minStat = stats.min;
        }
        
        let maxStat = stats.maximum;
        if (typeof maxStat !== 'number' || !isFinite(maxStat)) {
          maxStat = stats.max;
        }
        
        // Update age range based on both fields
        if (typeof minStat === 'number' && isFinite(minStat)) {
          ageMinValue = Math.min(ageMinValue, minStat);
        }
        
        if (typeof maxStat === 'number' && isFinite(maxStat)) {
          ageMaxValue = Math.max(ageMaxValue, maxStat);
        }
        
        return; // Skip individual age fields
      }
      
      // Handle numeric fields
      if (numericFields.includes(field)) {
        const stats = data.statistics || {};
                
        // Extract min value, handling possible different property names
        let minValue: number;
        if (typeof stats.minimum === 'number' && isFinite(stats.minimum)) {
          minValue = stats.minimum;
        } else if (typeof stats.min === 'number' && isFinite(stats.min)) {
          minValue = stats.min;
        } else {
          // Default fallbacks based on field type
          console.warn(`Missing valid min value for ${field}, using default`);
          if (field === "sample_size") {
            minValue = 0;
          } else if (field === "start_year" || field === "end_year") {
            minValue = 1900;
          } else if (field === "duration_years") {
            minValue = 0;
          } else if (field === "num_variables" || field === "num_sweeps") {
            minValue = 0;
          } else {
            minValue = 0;
          }
        }
        
        // Extract max value, handling possible different property names
        let maxValue: number;
        if (typeof stats.maximum === 'number' && isFinite(stats.maximum)) {
          maxValue = stats.maximum;
        } else if (typeof stats.max === 'number' && isFinite(stats.max)) {
          maxValue = stats.max;
        } else {
          // Default fallbacks based on field type
          console.warn(`Missing valid max value for ${field}, using default`);
          if (field === "sample_size") {
            maxValue = 100000;
          } else if (field === "start_year" || field === "end_year") {
            maxValue = 2024;
          } else if (field === "duration_years") {
            maxValue = 100;
          } else if (field === "num_variables") {
            maxValue = 10000;
          } else if (field === "num_sweeps") {
            maxValue = 50;
          } else {
            maxValue = 100;
          }
        }
        
        // Ensure max is greater than min
        if (maxValue <= minValue) {
          maxValue = minValue + 1;
        }
        
        // Create numeric range filter
        const options = Array.from(
          { length: 101 },
          (_, i) => String(minValue + (i / 100) * (maxValue - minValue))
        );
        
        aggregateFilters.push({
          id: field,
          label: field
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          type: "range",
          options,
        });
      } else {
        // Regular categorical filter
        const buckets = data.buckets || [];
        
        // Only add filter if there are options
        if (buckets.length > 0) {
          aggregateFilters.push({
            id: field,
            label: field
              .replace(/_/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase()),
            type: "multiselect",
            options: buckets.map((bucket: any) => bucket.key || ""),
          });
        }
      }
    });

    // Add combined age range filter if we have valid values
    if (isFinite(ageMinValue) && isFinite(ageMaxValue) && ageMinValue <= ageMaxValue) {
      // Ensure max is greater than min
      if (ageMaxValue <= ageMinValue) {
        ageMaxValue = ageMinValue + 1;
      }
      
      const ageOptions = Array.from(
        { length: 101 },
        (_, i) => String(ageMinValue + (i / 100) * (ageMaxValue - ageMinValue))
      );
      
      aggregateFilters.push({
        id: "age_range",
        label: "Age Range",
        type: "range",
        options: ageOptions,
      });
    } else {
      // Add default age range if we don't have valid values
      console.warn("Missing valid age range data, using defaults");
      const defaultAgeMin = 0;
      const defaultAgeMax = 100;
      
      const ageOptions = Array.from(
        { length: 101 },
        (_, i) => String(defaultAgeMin + (i / 100) * (defaultAgeMax - defaultAgeMin))
      );
      
      aggregateFilters.push({
        id: "age_range",
        label: "Age Range",
        type: "range",
        options: ageOptions,
      });
    }

    return aggregateFilters;
  };

  // Search only when debounced search query or selected filters change
  // This prevents excessive API calls during typing
  useEffect(() => {
    if (!apiOffline) {
      performSearch();
    }
  }, [debouncedSearchQuery, selectedFilters, resourceTypeFilter 
    // , currentPage
  ]);

  const totalPages = Math.ceil(totalHits / resultsPerPage);

  return (
    <Box sx={{ py: 4 }}>
      <Container maxWidth="xl">
        {/* Search Section */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 3, mb: 4 }}>
          <TextField
            fullWidth
            placeholder="What are you searching for?"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              // setCurrentPage(1); // Reset to first page on new search
            }}
            InputProps={{
              endAdornment: (
                <Box sx={{ mr: 1, ml: -0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  {searchQuery !== debouncedSearchQuery && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      Typing...
                    </Typography>
                  )}
                  <Image
                    src="/icons/discover.svg"
                    alt="Search"
                    width={20}
                    height={20}
                  />
                </Box>
              ),
              sx: {
                height: 48,
                "& .MuiOutlinedInput-root": { borderRadius: 24 },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "grey.200",
                },
              },
            }}
            sx={{ "& .MuiOutlinedInput-root": { borderRadius: 24 } }}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Button
              variant="contained"
              color="secondary"
              sx={{
                minWidth: 0,
                width: 40,
                height: 40,
                borderRadius: "50%",
                p: 0,
              }}
            >
              <ArrowDropDownIcon />
            </Button>
            <Typography
              sx={{ color: "#191B22", fontWeight: 500, whiteSpace: "nowrap" }}
            >
              Advanced Search
            </Typography>
          </Box>
        </Box>

        {/* Filter Panel with initial filters */}
        <FilterPanel
          filtersData={filters}
          onSelectionChange={handleFilterSelection}
        />
        
        {/* Debug button - only visible in development */}
        {process.env.NODE_ENV !== 'production' && (
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={toggleDebug}
              sx={{ 
                fontSize: '0.7rem',
                textTransform: 'none',
                py: 0.5
              }}
            >
              {showDebug ? 'Hide Debug Info' : 'Debug API Responses'}
            </Button>
          </Box>
        )}
        
        {/* Debug panel */}
        {showDebug && (
          <Box sx={{ mb: 4, p: 2, border: '1px dashed', borderColor: 'grey.300', borderRadius: 1 }}>
            <Typography variant="h6" gutterBottom>Debug Information</Typography>
            <Typography variant="body2">
              API responses are saved to:
              <ul>
                <li><code>window.__lastSearchResponse</code> - Latest search response</li>
                <li><code>window.__lastAggregateResponse</code> - Latest aggregations response</li>
                <li><code>window.__debugState</code> - Current component state</li>
              </ul>
              
              <strong>Current Search:</strong> {debouncedSearchQuery || '(empty)'}<br />
              <strong>Total hits:</strong> {totalHits}<br />
              {/* <strong>Page:</strong> {currentPage} of {Math.ceil(totalHits / resultsPerPage)} (Total hits: {totalHits})<br /> */}
              <strong>Selected Filters:</strong> {Object.keys(selectedFilters).length > 0 
                ? Object.keys(selectedFilters).map(k => `${k} (${selectedFilters[k].length})`).join(', ') 
                : 'None'}
            </Typography>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={() => {
                debugState();
                // Copy debug information to clipboard
                const debugInfo = JSON.stringify({
                  search: debouncedSearchQuery,
                  // page: currentPage,
                  totalHits,
                  selectedFilters
                }, null, 2);
                navigator.clipboard.writeText(debugInfo);
                alert('Debug info copied to clipboard');
              }}
              sx={{ mt: 1, mr: 1 }}
            >
              Copy Debug Info
            </Button>
            <Button 
              variant="outlined" 
              color="error"
              size="small" 
              onClick={() => {
                console.clear();
                performSearch();
              }}
              sx={{ mt: 1 }}
            >
              Clear & Reload
            </Button>
          </Box>
        )}

        {/* Main Content Area - Responsive Layout */}
        <Box 
          sx={{ 
            display: isMobile ? "block" : "grid",
            gridTemplateColumns: "1fr 1fr", // Exactly 50-50 split using grid
            gap: 4,
            width: "100%"
          }}
        >
          {/* Search Results Panel - Full width on mobile */}
          <Box 
            sx={{ 
              width: "100%", // Always 100% of its grid cell
              minWidth: 0,
              overflowX: "hidden" // Prevent any content from breaking out
            }}
          >
            {loading ? (
              <Typography>Loading search results...</Typography>
            ) : apiOffline ? (
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                textAlign: 'center',
                py: 8,
                px: 4
              }}>
                <CloudOffIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h5" color="text.secondary" gutterBottom>
                  The discovery API is currently offline
                </Typography>
                <Typography color="text.secondary">
                  Please try again soon. We apologize for the inconvenience.
                </Typography>
                <Button 
                  variant="contained" 
                  sx={{ mt: 4 }}
                  onClick={() => {
                    setApiOffline(false);
                    // Call the function that will retry fetching aggregations
                    // This will trigger the useEffect that contains fetchInitialAggregations
                    performSearch();
                  }}
                >
                  Retry Connection
                </Button>
              </Box>
            ) : (
              <>
                {/* Pagination Controls - Top */}
                {totalPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <Pagination 
                      count={totalPages} 
                      page={currentPage} 
                      onChange={handlePageChange} 
                      color="primary" 
                    />
                  </Box>
                )}
                <SearchResults
                  results={results}
                  resourceTypeFilter={resourceTypeFilter}
                  onSelectResult={handleSelectResult}
                  selectedResultId={selectedResult?.extra_data?.uuid}
                />
                
                {/* Simple results count info - Condition updated */}
                {results.length > 0 && totalHits > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      {totalHits} total results (showing up to {resultsPerPage})
                    </Typography>
                  </Box>
                )}
              </>
            )}
            {/* Pagination Controls - Bottom (Moved here) */}
            {totalPages > 1 && !loading && !apiOffline && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <Pagination 
                  count={totalPages} 
                  page={currentPage} 
                  onChange={handlePageChange} 
                  color="primary" 
                />
              </Box>
            )}
          </Box>

          {/* Study Detail Panel - Only shown on desktop */}
          {!isMobile && (
            <Box
              sx={{
                width: "100%", // Always 100% of its grid cell
                bgcolor: "background.paper",
                borderLeft: "1px solid",
                borderColor: "grey.200",
                height: "auto",
                position: "sticky",
                top: 24,
                maxHeight: "calc(100vh - 48px)",
                display: "flex",
                flexDirection: "column",
                overflowX: "hidden" // Prevent any content from breaking out
              }}
            >
              {apiOffline ? (
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  textAlign: 'center',
                  p: 4,
                  height: '100%'
                }}>
                  <CloudOffIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    API Offline
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Study details unavailable
                  </Typography>
                </Box>
              ) : (
                // Conditionally render StudyDetail or placeholder
                studyDetail ? (
                  <StudyDetail 
                    study={studyDetail}
                    isDrawerView={false}
                  />
                ) : (
                  <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                    <Typography color="text.secondary">
                      Select a dataset to view details
                    </Typography>
                  </Box>
                )
              )}
            </Box>
          )}
        </Box>

        {/* Mobile Drawer for Study Details */}
        <Drawer
          anchor="right"
          open={isMobile && drawerOpen}
          onClose={handleCloseDrawer}
          sx={{
            '& .MuiDrawer-paper': { 
              width: { xs: '100%', sm: '80%', md: '60%' }, 
              maxWidth: '600px',
              p: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            },
          }}
        >
          <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'grey.200', p: 1 }}>
            <IconButton 
              onClick={handleCloseDrawer}
              sx={{ position: 'absolute', top: 8, right: 8 }}
            >
              <CloseIcon />
            </IconButton>
            <Box sx={{ py: 1, pl: 1, pr: 6, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>
                {selectedResult ? selectedResult.dataset_schema?.name || "Study Details" : "Study Details"}
              </Typography>
              {selectedResult && (
                (selectedResult.dataset_schema && (selectedResult.dataset_schema as any).image) || 
                ((selectedResult as any).image) 
              ) && (
                <Box
                  sx={{
                    width: 50,
                    height: 50,
                    position: "relative",
                    borderRadius: "4px",
                    overflow: "hidden",
                    flexShrink: 0
                  }}
                >
                  <Image
                    src={(selectedResult.dataset_schema && (selectedResult.dataset_schema as any).image) || 
                         (selectedResult as any).image}
                    alt={selectedResult.dataset_schema?.name || "Study image"}
                    fill
                    style={{ objectFit: "cover" }}
                    unoptimized={true}
                  />
                </Box>
              )}
            </Box>
          </Box>
          <Box sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* Conditionally render StudyDetail or placeholder in drawer */}
            {studyDetail ? (
              <StudyDetail 
                study={studyDetail}
                isDrawerView={true}
              />
            ) : (
              <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                <Typography color="text.secondary">
                  Select a dataset to view details
                </Typography>
              </Box>
            )}
          </Box>
        </Drawer>
      </Container>
    </Box>
  );
}

// Main page component with Suspense boundary
export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <Box sx={{ p: 4 }}>
          <Typography>Loading...</Typography>
        </Box>
      }
    >
      <DiscoverPageContent />
    </Suspense>
  );
}
