## Signing in

### I can't sign in, what do I do?

Only approved users have access to the system. If the email address you are
signing in with has not been added as a user, you won't be able to sign in. Ask
a system administrator for access, or request access by sending your email
address through [this form](/request-access).

### … but I have already been added!

Then something is probably wrong in the system. Contact a system administrator.

---

## Permission to make changes

### I can't add or change objectives and key results

You must be a member of a product to make changes to it. Other registered team
members can add you to the product if you should have access.

### … but the team has no members!

Contact a system administrator to be added as a member of a team.

### Adding team members

On the product page, click «Admin» in the top menu, then enter a name or email
address in the «Team members» field.

If the person you want to add is not in the list, a system administrator must
add the user to the system first.

Only system administrators and existing team members can add new members.

---

## Profile

### How do I change my display name?

Open the profile menu with the button on the far right of the top menu, change
the «Name» field and click `Save`.

### How do I change the language?

Open the profile menu, choose a language in the «Language» field and click
`Save`. The app is available in English and Chinese.

---

## Administrator

### Opening the admin panel

Administrators have access to the admin panel. Click the user profile button on
the far right of the top menu and choose «Admin».

### Adding a new user to the system

Only system administrators can add new users to the system. Administrators
manage users from the [admin panel](/admin).

### Granting or removing admin rights for a user

Administrators can grant or remove admin rights for users from the
[admin panel](/admin).

---

## Organizations

Organizations are the top level and contain [departments](#departments).
Organizations can also have their own [objectives](#objectives) and
[key results](#key-results).

### Creating a new organization

Administrators can create new organizations from the [admin panel](/admin).

- In the «Organizations» column, click `Add organization`.
- Enter a name and mission statement.
- Add the members of the organization.
- Click `Create`.

### Archiving an organization

Administrators can archive existing organizations from the
[admin panel](/admin). Archived organizations can be restored.

- Select the organization in the menu.
- Click `Delete`.

### Restoring an organization

Archived organizations can be restored by system administrators from the
[admin panel](/admin).

- Tick «View archived objects» at the bottom of the page.
- Select the organization to restore.
- Click `Restore`.

### Permanently deleting an organization

This is not possible.

### Managing objectives and key results for an organization

Only administrators can create, change and delete _objectives_ and _key results_
for an organization.

- Go to the organization page (click the organization's name on the front page).
- Choose «Admin» in the top menu.
- Follow the steps under [objectives](#objectives) and
  [key results](#key-results).

---

## Departments

Departments contain [products](#products), [objectives](#objectives) and
[key results](#key-results).

### Creating a new department

Administrators can create new departments from the [admin panel](/admin).

- In the «Departments» column, click `Add department`. An organization must
  exist before you can create a department.
- Enter a name and mission statement.
- Choose the organization it belongs to and its members.
- Click `Create`.

### Archiving a department

Administrators can archive existing departments from the [admin panel](/admin).
Archived departments can be restored.

- Select the department in the menu.
- Click `Delete`.

### Restoring a department

Archived departments can be restored by system administrators from the
[admin panel](/admin).

- Tick «View archived objects» at the bottom of the page.
- Select the archived department to restore.
- Click `Restore`.

---

## Products

Products belong to a [department](#departments) and contain
[objectives](#objectives) and [key results](#key-results).

### Creating a new product

Administrators can create new products from the [admin panel](/admin).

- In the «Products» column, click `Add product`. A department must exist before
  you can create a product.
- Enter a name and mission statement.
- Choose the department it belongs to and its members.
- Click `Create`.

### Archiving a product

Administrators can archive existing products from the [admin panel](/admin).
Archived products can be restored.

- Select the product in the menu.
- Click `Delete`.

### Restoring an archived product

Archived products can be restored by system administrators from the
[admin panel](/admin).

- Tick «View archived objects» at the bottom of the page.
- Select the archived product to restore.
- Click `Restore`.

---

## Objectives

An _objective_ is something your team wants to achieve. It does not have to be
completely concrete.

### Creating a new objective

- Go to the product, department or organization you want to create an objective
  for.
- Click the `+ Objective` button at the top right.
- Enter a name, description and period.
- Click `Create objective`.

New key results can now be linked to this objective.

### How is progress calculated?

The progress of an objective is the weighted average of the progress of its key
results.

### Archiving an objective

- Go to the objective you want to archive.
- Click the `Change objective` button.
- Click `Delete` at the bottom of the drawer.

---

## Key results

Key results are what you _measure_ for a specific [objective](#objectives).

### Creating a new key result

- Go to the objective you want to create a key result for.
- Click `+ Create key result`.
- Fill in the fields.
- Click `Continue`, then `Complete` when you are done.

### Registering progress for a key result

Only administrators and team members can register progress for a key result.

Progress is registered on the key result's detail page. Progress can also be
registered through the API.

### Deleting or changing progress for a key result

Only administrators and team members can change progress for a key result.

On the key result page (click a key result to open it), you can delete a value
with the delete button to the right of the value.

On the same page, an existing value can be changed with the edit button to the
right of the value.

### How is progress calculated?

The progress of a key result is the current value as a percentage of the
distance between the start and target values. If the current value is below the
start value, progress is set to 0 %, and if it has passed the target value,
progress is set to 100 %.

### Archiving a key result

- Go to the key result you want to archive.
- Click the `Edit key result` button.
- Click `Delete` at the bottom of the drawer.

---

## Measurements

### Adding a new measurement

- Go to your product, department or organization.
- Open the «Measurements» tab.
- Click «Create a measurement».
- Fill in the form and click «Save».

### Updating measurement values

Measurement values can be updated in two ways:

1. Directly in the OKR-tracker with the «New value» button.

2. Through the API. Instructions are shown when you edit or create a
   measurement.
