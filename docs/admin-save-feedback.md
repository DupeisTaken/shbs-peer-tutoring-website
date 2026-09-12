# Saved-change feedback

Admin editors show a floating **Changes saved** message only after the server confirms the mutation. It closes automatically after 4.5 seconds or can be dismissed.

Failed mutations show a persistent error that must be dismissed. Coordinator proposals retain **Submitted for approval** feedback and a link to the request; they never announce that live records were saved. Preparing a confirmation ticket does not announce a saved change.

Errors remain visible even if a later edit succeeds. Identical repeated errors collapse into one notice. Approval, error and saved notices share a bounded, scrollable stack so they cannot cover one another.

The shared tRPC mutation cache provides this behavior for management writes, including program settings, so new editors do not need separate success-message state.
