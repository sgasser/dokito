# Synthetic code repository

This Repository contains no Dokito-specific files.

In a real checkout, Dokito normalizes its existing Git remote, such as
`git@github.com:example/web-app.git`, and matches it to the
`github` registration in `product-area/dokito.yaml`.

The synthetic test fixture creates the temporary Git metadata at runtime
because nested `.git` directories do not belong in a fixture.
