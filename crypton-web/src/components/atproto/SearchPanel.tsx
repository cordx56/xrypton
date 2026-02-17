"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { AppBskyActorDefs } from "@atproto/api";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useI18n } from "@/contexts/I18nContext";
import Spinner from "@/components/common/Spinner";

const SearchPanel = () => {
  const { agent } = useAtproto();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!agent || !query.trim()) return;
    setSearching(true);
    try {
      const res = await agent.searchActors({ q: query.trim(), limit: 25 });
      setResults(res.data.actors);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [agent, query]);

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-4 py-3 border-b border-accent/20">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t("atproto.search")}
            className="flex-1 px-4 py-2 rounded-lg bg-panel border border-accent/30 text-fg placeholder-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className="px-4 py-2 rounded-lg bg-accent text-white font-medium disabled:opacity-50 transition-opacity"
          >
            {t("atproto.search")}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searching && <Spinner />}
        {!searching &&
          results.map((actor) => (
            <Link
              key={actor.did}
              href={`/atproto/profile/${actor.handle}`}
              className="flex items-center gap-3 px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors"
            >
              {actor.avatar ? (
                <img
                  src={actor.avatar}
                  alt=""
                  className="w-10 h-10 rounded-full"
                  loading="lazy"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-accent/20" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {actor.displayName ?? actor.handle}
                </p>
                <p className="text-xs text-muted truncate">@{actor.handle}</p>
                {actor.description && (
                  <p className="text-xs text-muted line-clamp-1 mt-0.5">
                    {actor.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
};

export default SearchPanel;
