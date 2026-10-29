import { LoginForm } from "./LoginForm";

export const metadata = { title: "FocusX admin · Sign in" };

export default function LoginPage() {
  return (
    <main className="login">
      <h1>FocusX admin</h1>
      <p className="muted">Sign in with the email and password made by <code>npm run admin:create</code>.</p>
      <LoginForm />
    </main>
  );
}
