# kute

## -- Matugen

### matugen template (*~/.config/matugen/template/kute.json*)
```json
{
  "primary": "{{colors.primary.default.hex}}",
  "background": "{{colors.background.default.hex}}",
  "surface": "{{colors.surface.default.hex}}",
  "onBackground": "{{colors.on_background.default.hex}}",
  "onSurface": "{{colors.on_surface.default.hex}}",
  "primaryContainer": "{{colors.primary_container.default.hex}}",
  "onPrimaryContainer": "{{colors.on_primary_container.default.hex}}",
  "secondary": "{{colors.secondary.default.hex}}"
}
```

### matugen config (*~/.config/matugen/config.toml*)
```toml
[templates.kute]
input_path = '~/.config/matugen/templates/kute.json'
output_path = '~/.config/kute-player/matugen/kute.json'
```