# `.mdj` fixtures

These files were **written by hand** for UML Studio's experimental StarUML importer tests. They follow
the publicly visible structure of StarUML project files (`_type`, `_id`, `_parent`, `ownedElements`,
`ownedViews`, `$ref` references, `left/top/width/height` view geometry, `points` edge geometry).

They were **not** produced by StarUML. Passing tests against them does not prove compatibility with
files saved by any StarUML version. To verify real interoperability, add files saved by the target
StarUML version (created by you, with content you are allowed to share) and extend
`tests/services/mdjImport.test.ts`.
