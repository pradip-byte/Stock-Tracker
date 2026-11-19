-- The company's own website, from the data provider. Its domain is added to the
-- web search allowlist for that company's AI read, so its investor pages can be used.

alter table public.fundamentals
  add column if not exists website text;
