import Footer from "@/modules/Footer";
import Header from "@/modules/Header";
import { useEffect, useState } from "react";
import CartWrapper from "context/CartWrapper";
import { AnimatePresence, motion } from "framer-motion";
import type { AppProps } from "next/app";
import Head from "next/head";
import "styles/globals.css";
import axios from "axios";
import { Category } from "types/products";

function MyApp({ Component, pageProps, router }: AppProps) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const categories = async () => {
      let cat;
      do {
        cat = await axios.get(
          `${process.env.NEXT_PUBLIC_BASEURL}/getCategories`
        );
      } while (cat.data.categories[0].subCategories.length === 0);
      return cat;
    };

    categories().then((result: any) => {
      setCategories(result.data.categories);
    });
  }, [Component]);

  return (
    <div className="flex flex-col">
      <CartWrapper>
        <Header categories={categories} />
        <div>
          <Head>
            <title>FluidPower Group</title>
          </Head>

          <AnimatePresence
            mode="wait"
            onExitComplete={() => window.scrollTo(0, 0)}
          >
            <motion.div
              key={router.route}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Component {...pageProps} />
            </motion.div>
          </AnimatePresence>
        </div>
      </CartWrapper>
      <Footer />
    </div>
  );
}

export default MyApp;
