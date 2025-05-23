"use client";

import { Box, Stack, Typography } from "@mui/material";
import { SearchResult } from "@/services/api";
import CompactResultCard from "@/components/CompactResultCard";

interface SearchResultsProps {
  results: SearchResult[];
  resourceTypeFilter?: string[];
  onSelectResult?: (result: SearchResult) => void;
  selectedResultId?: string;
}

export default function SearchResults({
  results,
  resourceTypeFilter,
  onSelectResult,
  selectedResultId,
}: SearchResultsProps) {
  // Filter results based on resourceTypeFilter if provided, using case-insensitive comparison
  let filteredResults =
    resourceTypeFilter && resourceTypeFilter.length > 0
      ? results.filter((result) =>
          result.extra_data?.resource_type && resourceTypeFilter
            .map((type) => type.trim().toLowerCase())
            .includes(result.extra_data?.resource_type.trim().toLowerCase())
        )
      : results;

  // Sort filtered results by cosine_similarity (highest similarity on top), 
  // falling back to score if cosine_similarity is not available
  const sortedResults = filteredResults.sort((a, b) => {
    const similarityA = a.cosine_similarity || a.score || 0;
    const similarityB = b.cosine_similarity || b.score || 0;
    return similarityB - similarityA;
  });

  // Debug log to inspect filtering and sorting
  console.log("SearchResults debug:", {
    resourceTypeFilter,
    originalResults: results,
    filteredResults,
    sortedResults
  });

  const handleSelectResult = (result: SearchResult) => {
    if (onSelectResult) {
      onSelectResult(result);
    }
  };

  if (!sortedResults.length) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography color="text.secondary">
          No results found. Try adjusting your search criteria.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1">
          {sortedResults.length} results
        </Typography>
      </Box>

      <Stack spacing={1.5} sx={{ mb: 4 }}>
        {sortedResults.map((result, index) => {
          // Determine if this result is selected
          const isSelected = selectedResultId === result.extra_data?.uuid;
          
          return (
            <CompactResultCard 
              key={result.extra_data?.uuid || `result-${index}`}
              result={result}
              isSelected={isSelected}
              onClick={() => handleSelectResult(result)}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
