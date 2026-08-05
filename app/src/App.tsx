import { BrowserRouter, Route, Routes } from "react-router-dom";
import Today from "./routes/Today";
import Animals from "./routes/Animals";
import AnimalRecord from "./routes/AnimalRecord";
import StoreProducts from "./routes/StoreProducts";
import BooksTransactions from "./routes/BooksTransactions";
import CustomerStore from "./routes/CustomerStore";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/animals" element={<Animals />} />
        <Route path="/animals/:tag" element={<AnimalRecord />} />
        <Route path="/store/products" element={<StoreProducts />} />
        <Route path="/books/transactions" element={<BooksTransactions />} />
        <Route path="/shop" element={<CustomerStore />} />
      </Routes>
    </BrowserRouter>
  );
}
