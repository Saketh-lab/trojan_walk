// Demo accounts. Signing in is just picking one: no email, no magic link, no environment variable.
// The password is deliberately fixed and public: these are fake accounts with fake data, and the
// @usc.edu-only database trigger keeps real addresses out. Remove this file's password and
// /api/dev-login before any real deployment.
export const DEMO_PASSWORD = "trojanwalk-demo";

export const DEMO_USERS = [
  { email: "demo1@usc.edu", name: "Ana" },
  { email: "demo2@usc.edu", name: "Ben" },
  { email: "demo3@usc.edu", name: "Cam" },
  { email: "demo4@usc.edu", name: "Dee" },
] as const;
