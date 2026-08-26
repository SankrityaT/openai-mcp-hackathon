# Local database verification

These commands target only the local Supabase stack. Do not add `--linked`, a database URL, or a project reference.

Prerequisites:

- The already-approved Supabase CLI.
- A running Docker-compatible runtime.

Run:

```bash
supabase start
supabase db reset --local --no-seed
supabase test db
supabase db lint --local --schema public --level warning --fail-on error
```

Regenerate local types into a temporary review file, then compare rather than blindly replacing the hand-authored contract:

```bash
supabase gen types typescript --local --schema public > .context/database.generated.types.ts
diff -u src/core/database.types.ts .context/database.generated.types.ts
```

Stop the local stack when finished:

```bash
supabase stop
```

Remote migration remains a separate, explicitly approved operation. Confirm the exact Cardea project target, inspect `supabase db push --dry-run`, then request approval before running `supabase db push`.
