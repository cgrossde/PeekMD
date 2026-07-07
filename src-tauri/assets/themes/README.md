# Vendored syntax themes

`GitHub-Dark.tmTheme` and `GitHub-Light.tmTheme` are GitHub's official syntax
themes, taken verbatim from
[primer/github-textmate-theme](https://github.com/primer/github-textmate-theme)
(archived, MIT licensed — see `LICENSE` in this folder).

These are build-time-only inputs consumed by
`src-tauri/src/bin/gen_syntect_css.rs` to regenerate
`src/vendor/syntect-github-{light,dark}.css`. They are not read at runtime and
are not part of the shipped app bundle.

Previously this project used syntect's *bundled* default themes
(`InspiredGitHub` for light, `base16-ocean.dark` for dark) as a stand-in.
`InspiredGitHub` is a reasonable approximation of GitHub Light, but
`base16-ocean.dark` is an unrelated blue/teal palette with no relationship to
GitHub's actual dark syntax colors — despite the SPEC and UI both claiming
"GitHub Light / GitHub Dark". Vendoring GitHub's own theme files closes that
gap.

To regenerate the CSS after touching either `.tmTheme` file or
`gen_syntect_css.rs`:

```bash
cd src-tauri
cargo run --bin gen_syntect_css
```
