# Artscry

Discover Magic: The Gathering card illustrations at random, and keep the ones you love.

- **Random draw** from all ~57,000 illustrations on [Scryfall](https://scryfall.com), one by one or as a sheet, filtered with any Scryfall query (`t:dragon`, `artist:"John Avon"`…).
- **Never see the same art twice**: every illustration shown is remembered per account and skipped next time ("Hide seen").
- **Favorites with 1 to 3 hearts** (Like / Love / Obsessed), browsable by level.
- **Browse by set**, with how many illustrations of each set you have seen and favorited; pick "Unseen only" or "All cards".
- Light / dark theme (all colors in `app/assets/stylesheets/theme.css`).

## Stack

Rails 8.1, SQLite, Tailwind CSS, importmap (no Node build). Authentication uses the Rails 8 generator. Card images and searches come straight from the Scryfall API in the browser; the server stores accounts, seen illustrations, ratings and a set catalog.

## Development

```sh
bin/setup                  # install gems, prepare the database
bin/rails db:seed          # dev account: user@test.com / test
bin/rails catalog:import   # set catalog from Scryfall (~80 MB download, a few seconds)
bin/dev                    # http://localhost:3000
bin/rails test
```

## Deployment

Configured for [Kamal](https://kamal-deploy.org) in `config/deploy.yml` (fill in your server and registry). The SQLite databases live in the `artscry_storage` volume. In production, `ImportCatalogJob` refreshes the set catalog every Monday (`config/recurring.yml`).

Card data and images © Wizards of the Coast, provided by Scryfall. Artscry is unofficial fan content, not approved or endorsed by Wizards.
