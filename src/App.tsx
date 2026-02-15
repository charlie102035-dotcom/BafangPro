import AuthGate from './components/AuthGate';
import AppShell from './components/AppShell';

function App() {
  return (
    <AuthGate>
      {(user) => <AppShell key={user.id} userId={user.id} authUser={user} />}
    </AuthGate>
  );
}

export default App;
