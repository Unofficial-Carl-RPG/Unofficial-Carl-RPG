# Carl RPG

An unofficial FoundryVTT (v13) system for the Dungeon Crawler Carl RPG, built from the
[Boilerplate system](https://github.com/asacolips-projects/boilerplate-system).

- Package id: `carl-rpg`
- Display name: Carl RPG

## Layout

- `module/`: all system code (`carl-rpg.mjs` is the entry point; `data/`, `documents/`, `sheets/`, `helpers/`)
- `templates/`: Handlebars templates for actor and item sheets
- `css/`: compiled stylesheet (`carl-rpg.css`)
- `src/scss/`: SCSS source for the stylesheet
- `lang/`: localization (`CARL_RPG.*` keys)

## Compiling the CSS

```bash
npm install
npm run build   # one-off compile to css/carl-rpg.css
npm run watch   # recompile on change
```

## Status

Early work in progress. Character sheet fields follow the official character sheet; derived values
that are marked `TODO` in `module/data/actor-crawler.mjs` are placeholders until checked against the rulebook.
