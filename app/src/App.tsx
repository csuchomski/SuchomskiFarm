import { HashRouter, Route, Routes } from "react-router-dom";
import Today from "./routes/Today";
import Animals from "./routes/Animals";
import AnimalRecord from "./routes/AnimalRecord";
import StoreProducts from "./routes/StoreProducts";
import BooksTransactions from "./routes/BooksTransactions";
import CustomerStore from "./routes/CustomerStore";
import { AppStateProvider } from "./lib/store";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./components/auth/RequireAuth";

// Hash routing rather than browser routing: this deploys to GitHub Pages
// (a static file host with no server-side rewrite config), so a clean
// /animals/1103-style deep link would 404 on refresh. Hash paths
// (#/animals/1103) resolve client-side with zero server config, and work
// identically on GitHub Pages, Vercel, Netlify, or a plain static bucket —
// portable over pretty URLs, for an internal family-farm tool.
export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <HashRouter>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/" element={<Today />} />
              <Route path="/animals" element={<Animals />} />
              <Route path="/animals/:tag" element={<AnimalRecord />} />
              <Route path="/store/products" element={<StoreProducts />} />
              <Route path="/books/transactions" element={<BooksTransactions />} />
            </Route>
            {/* Customer store sits outside the auth gate — a customer isn't
                a farm_members row. See RequireAuth's comment. */}
            <Route path="/shop" element={<CustomerStore />} />
          </Routes>
        </HashRouter>
      </AppStateProvider>
    </AuthProvider>
  );
}
