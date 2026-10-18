# Fixtures

Checked-in test data. (`samples/` is the git-ignored drop folder for
files that should not be published, such as Firaxis' `DefaultGameCore.ini`.)

## saves/

PC Enemy Within saves with Long War 1.0 (and two with Long War Rebalanced
2.06, named `lwr-…`), English, one machine, not Ironman.

| File | Campaign | In-game date | Kind |
| --- | --- | --- | --- |
| save1719 | 55 | 5 Dec 2016 | tactical: alien base assault |
| save1724 | 55 | 7 Dec 2016 | tactical: UFO landing |
| save1738 | 55 | 14 Dec 2016 | geoscape |
| save1739 | 55 | 15 Dec 2016 | tactical: UFO crash |
| save1750 | 55 | 21 Dec 2016 | tactical: EXALT base |
| save1752 | 55 | 24 Dec 2016 | tactical: abduction |
| save1760 | 56 | 16 Mar 2016 | geoscape |
| save1761 | 56 | 24 Mar 2016 | geoscape |
| save1762 | 56 | 25 Mar 2016 | geoscape |
| lwr-save1740 | 58 | 1 Mar 2030 | LWR 2.06, tactical: abduction |
| lwr-save1779 | 58 | 1 Mar 2030 | LWR 2.06, geoscape, first day |

`save1762.json` is xcomsave's `xcom2json` output for `save1762`: the
oracle the TypeScript parser is compared against, property for property.
