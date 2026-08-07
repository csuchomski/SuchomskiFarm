import { HashRouter, Route, Routes } from "react-router-dom";
import Home from "./routes/Home";
import Animals from "./routes/Animals";
import AnimalRecord from "./routes/AnimalRecord";
import Lactations from "./routes/Lactations";
import Milkings from "./routes/Milkings";
import Genetics from "./routes/Genetics";
import Sires from "./routes/Sires";
import StoreProducts from "./routes/StoreProducts";
import BooksTransactions from "./routes/BooksTransactions";
import CustomerStore from "./routes/CustomerStore";
import { AuthProvider } from "./lib/auth";
import { WorkspaceProvider } from "./lib/workspace";
import { RequireAuth } from "./components/auth/RequireAuth";
import { RequireModule } from "./components/auth/RequireModule";

// Hash routing rather than browser routing: this deploys to GitHub Pages
// (a static file host with no server-side rewrite config), so a clean
// /animals/1103-style deep link would 404 on refresh. Hash paths
// (#/animals/1103) resolve client-side with zero server config, and work
// identically on GitHub Pages, Vercel, Netlify, or a plain static bucket —
// portable over pretty URLs, for an internal family-farm tool.
export default function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <HashRouter>
          <Routes>
            <Route element={<RequireAuth />}>
              {/* One adaptive home: farm businesses get Today, everything
                  else gets Overview. See routes/Home.tsx. */}
              <Route path="/" element={<Home />} />
              {/* Everything below is module-gated — switching to a business
                  without the module bounces back to "/" rather than leaving
                  you on another business's screen. */}
              <Route element={<RequireModule />}>
                <Route path="/animals" element={<Animals />} />
                <Route path="/animals/:tag" element={<AnimalRecord />} />
                <Route path="/lactations" element={<Lactations />} />
                <Route path="/milkings" element={<Milkings />} />
                <Route path="/genetics" element={<Genetics />} />
                <Route path="/sires" element={<Sires />} />
                <Route path="/store/products" element={<StoreProducts />} />
                <Route path="/books/transactions" element={<BooksTransactions />} />
              </Route>
            </Route>
            {/* Customer store sits outside the auth gate — a customer isn't
                a farm_members row. See RequireAuth's comment. */}
            <Route path="/shop" element={<CustomerStore />} />
          </Routes>
        </HashRouter>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
