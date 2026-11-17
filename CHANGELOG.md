## [17/11/25]
### Bug Fix — SSH/Private Key Files Exposed in Repo Directory
- **Issue**: SSH key files (`DavidUmunnnaKey1`, `DavidUmunnnaKey1.pub`) were sitting untracked in the project root and could be accidentally staged/committed.
- **Root cause**: `.gitignore` had no patterns covering SSH key files or private key naming conventions.
- **Fix**: Added a `SSH / private keys` section to `.gitignore` with patterns: `*.pem`, `*.key`, `*.pub`, `*Key*`, `*_rsa`, `*_ed25519`, `*_ecdsa`.
- **Impact**: Key files are now fully ignored by git and will not appear in `git status` or be stageable via `git add`.
- **Action required**: Move key files out of the repo directory to `~/.ssh/` to avoid accidental exposure through directory sharing or syncing.

---

### [13/03/25]
## Completed
tracking of userdata and logg in
segregate data based on roles
implement sign out

## changes made
sign out almost fully implemented
userdataa ttracking almost fully inplemented

## [14/03/25]
-USERTRACKING FOR FROnt end implemented(now logged in user can view user information on the dashboard  )
##in progress
-implementation of request history backend for user panel 

## [15/03/25]
-continuation of implementation process for request history implementation ✅

-stop app from rendering everytime refresh is clicked

## [16/03/25]
-implementation of no app rendering when refreshed 

## [04/05/25 -05/05/25]
-users should have departments in thier schema✅


## [15/05/25]
-skips tracking endpoints✅
-invoice generation schema
-invoice generation endpoints

-implement email password changes (implemented)
-create a dev branch (pending)


## export to excel functionality:
   - date range selection(make use of demobilization)
   - category selection(make use of categories)
   - excel sheet sent to the front end for download
   - post request that returns the downloadable



## email functionality:
- when a user makes a request an email containing the users name and request title is sent to the users superior that are involved in the approval of the request
- when an approval has been made an email will be sent to the user telling him that a change has been made with the details ofthe request that thechange was made on

## More Information Decision functionality
when the admin needs more info concerning a particular request he can update the status of the request to more information required then an email will be sent to the staff that more info is needed concerning his or her request


## Response per Request functionality
when the the staff wants to respond to his request that has a "More INformation" status