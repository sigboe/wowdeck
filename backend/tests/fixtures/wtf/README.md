# WTF backup fixtures

`upstream-wowup-backup.zip` — a backup in desktop WowUp's format, produced with the
same library version WowUp pins (`adm-zip` 0.5.12) following `wtf.service.ts`
`createBackup`: WTF contents at the archive root with explicit `dir/` entries plus
`wowup-meta.json` whose `contents` list the WTF root (`""`), every directory and every
file (paths with a leading `/`, sha256 file hashes, no `wowupDecky` block).

Tree inside: `Config.wtf`, `Account/ACC1/SavedVariables/A.lua`,
`Account/ACC1/Realm/Char/SavedVariables/B.lua`, empty dir `Account/ACC1/EmptyDir`.
