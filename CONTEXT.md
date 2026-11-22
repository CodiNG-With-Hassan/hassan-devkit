# hassan-devkit

The way of working shared by Hassan's client projects, shipped as versioned packages: worktrees
with isolated stacks, commit and CI standards, tracker adapters and the Claude layer. This
glossary holds the terms the devkit's own design uses.

## Language

**House skill**:
A skill written for this way of working and shipped by the devkit itself, as opposed to a skill
taken from the upstream skills dependency.
_Avoid_: devkit skill, custom skill, vendored skill

**Ready ticket**:
A ticket that has not been started and whose blockers are all done.
_Avoid_: unblocked ticket, available ticket, next ticket

**Setup PR**:
The first pull request of a project created from the template: the one that turns the template
into that project.
_Avoid_: initial PR, bootstrap PR, first PR
