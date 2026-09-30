// One place for the three account roles.
//   admin       — approves workshops, manages everything (e.g. Nitin)
//   coordinator — can submit new workshops for approval (e.g. Tanvi)
//   member      — sees everything, completes their own tasks
export const roleLabel = (role) => (role === "admin" ? "Admin" : role === "coordinator" ? "Coordinator" : "Member");
