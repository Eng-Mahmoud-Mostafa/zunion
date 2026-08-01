export type SeedUser = {
  username: string;
  full_name: string;
  email: string;
  role: string;
};

export const SEED_USERS: SeedUser[] = [
  { username: "mahmoud", full_name: "Mahmoud", email: "mahmoud@zunion.local", role: "Master" },
  { username: "reda", full_name: "Reda", email: "reda@zunion.local", role: "Master" },
  { username: "hassan", full_name: "Hassan", email: "hassan@zunion.local", role: "Master" },
  { username: "omar", full_name: "Omar", email: "omar@zunion.local", role: "Operator" },
  { username: "youssef", full_name: "Youssef", email: "youssef@zunion.local", role: "Operator" },
  { username: "khalifa", full_name: "Khalifa", email: "khalifa@zunion.local", role: "Operator" },
  { username: "opr1", full_name: "Opr 1", email: "opr1@zunion.local", role: "Operator" },
  { username: "opr2", full_name: "Opr 2", email: "opr2@zunion.local", role: "Operator" },
  { username: "opr3", full_name: "Opr 3", email: "opr3@zunion.local", role: "Operator" },
  { username: "supervisor1", full_name: "Supervisor 1", email: "supervisor1@zunion.local", role: "Supervisor" },
  { username: "supervisor2", full_name: "Supervisor 2", email: "supervisor2@zunion.local", role: "Supervisor" },
  { username: "supervisor3", full_name: "Supervisor 3", email: "supervisor3@zunion.local", role: "Supervisor" },
  { username: "finishing1", full_name: "Finishing 1", email: "finishing1@zunion.local", role: "Finishing" },
  { username: "finishing2", full_name: "Finishing 2", email: "finishing2@zunion.local", role: "Finishing" },
];

export const SEED_PASSWORD = "1234";
