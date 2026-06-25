# Schedule Generation

This document explains how Zombie TV builds schedules, which rules it applies, and how content selection is weighted.

## High-Level Flow

The scheduler runs in the background on startup and can also be triggered manually through the scheduler API. It generates a rolling multi-day schedule for each station, one day at a time.

For each station and day, the scheduler generally follows this order:

1. Skip the day if it already has a schedule.
2. Determine whether the date matches a holiday.
3. Load holiday override rules and station rules.
4. Load synced Plex media and apply allow/deny filters.
5. Load holiday-tagged catalog items and give them priority when the holiday is active.
6. Load special events and reserve their time windows.
7. Walk the day’s time blocks and place content block by block.
8. Write `Schedule` and `Slot` rows to the database.

## Core Rule Sources

Schedule generation is driven by these inputs:

- Station rules in `Station.rules`
- Holiday settings in `AdminPreference`
- Holiday overrides in `HolidayOverride`
- Holiday tags in the Plex catalog state
- Special events in `SpecialEvent`
- Synced Plex catalog media in `MediaItem`
- Curated YouTube filler in `YoutubeContent`

## Station Rules

Station rules control the slot template used for each day. The scheduler resolves weekday or weekend blocks and then applies the station-specific settings for those windows.

Per-slot rules include:

- `allowGenres`
- `libraryWeights`
- open and close bumper IDs
- filler windows metadata used by the admin UI and playback layer

Per-station rules also include:

- station-wide language allow/deny filters (`allow_languages`, `deny_languages`)
- the ad policy, which controls whether ad breaks are enabled and how often they appear for TV and movie content

## Holiday Handling

Holiday detection is date-based, not year-based. The app treats holidays as recurring month/day rules, with Easter and Good Friday calculated dynamically.

Holiday override behavior:

- Holidays can override the normal schedule.
- A holiday override can supply a content genre priority list.
- That priority list is used as a hard preference when the holiday is active.
- If tagged holiday content exists in the Plex catalog, tagged items are preferred first.
- If no tagged items match, the scheduler falls back to the override genre priorities.

This means holiday-tagged media in the Plex catalog always wins over general holiday genre preferences when it is available.

## Special Events

Special events reserve time windows before normal slot placement happens.

Event precedence is:

1. Higher priority events first
2. Earlier events next
3. Normal schedule only after reserved windows are skipped

Special events can be recurring yearly by date and time. If an event is marked as once-off, it is consumed after the next matching occurrence and then retired.

## Content Selection Rules

Once the scheduler reaches a block, it chooses from the current allowed media pool.

### Movies and Shows

For normal Plex-backed programming, the scheduler:

- filters out blocked media
- removes holiday-tagged items when they are not allowed for the current holiday
- applies genre and language allow/deny rules
- applies per-library weights to influence selection
- respects rating ceilings for the current time block

### Holiday Tag Priority

When a holiday is active, tagged media is treated as the preferred pool. That gives holiday curation a hard preference over the general override genre list.

If the holiday-tagged pool is empty, the scheduler falls back to the holiday override genre priority list.

### Library Weights

Library weights influence how likely a candidate is to be chosen from the current pool.

The current weighted library classes are:

- `tv_shows`
- `movies`
- `animation`
- `fitness`

These weights are applied when building candidate pools for a slot and influence the weighted random selection.

## Filler and YouTube Content

Filler and ad playback use `YoutubeContent` rows.

The scheduler and playback layer honor:

- category filters such as `ads`, `filler`, `music`, and `news`
- station-specific YouTube assignments
- runtime duration metadata when available

Ad breaks are added as runtime windows, and the playback layer keeps them playing to completion before resuming the main program.

## Slot Types

The scheduler works with the configured time blocks for the day:

- `movie`
- `episode`
- `mixed`
- `filler`
- `news`

The block type influences what kind of content the scheduler tries to place, but the final choice still depends on the active station rules, holiday rules, and event reservations.

## What Gets Written

Each generated schedule day creates:

- one `Schedule` row per station per day
- one or more `Slot` rows for the actual program blocks
- optional `SlotMediaItem` rows for Plex-backed slots

The `Slot` metadata stores useful runtime details such as the block name, holiday/event reason, and filler metadata used by playback.

## Playback Relationship

Schedule generation and playback are linked, but not identical:

- generation decides what should be on air
- playback decides what is currently on air and where the current position is

Playback re-reads the generated slots and uses their metadata to resolve current content, ad breaks, filler windows, and filler category selection.

## Summary

The scheduler is rule-driven and layered:

- station rules shape the available pool
- holidays can override the pool and prioritize tagged catalog items
- special events reserve windows ahead of the normal day blocks
- library weights bias the random selection inside the current pool
- playback uses the generated slot metadata to stay aligned with what the scheduler wrote

That gives the system a single generated schedule that still honors station configuration, holiday behavior, event reservations, and content weighting.