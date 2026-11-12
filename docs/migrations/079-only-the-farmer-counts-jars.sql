-- 079 — only the farmer counts jars
--
-- STATUS: not yet run
--
-- Asked for: customers not able to change how many jars they have out. Only
-- the farmer should.
--
-- 078 let a customer say in the shop "I'm bringing back this many", which
-- took that many off their own count on their word alone. The count is the
-- farm's record of where its jars are, so it should change only when the
-- farm sees the jars: record_jar_return and set_jar_count, both owner-only,
-- stay; the customer's own function goes.
--
-- A customer still reads their own lines and their own balance — the shop
-- shows them the number. Nothing on the ledger was written through this
-- function, so there is nothing to tidy.

drop function public.return_jars(bigint, integer);
