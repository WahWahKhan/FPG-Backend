import { motion } from "framer-motion";
import React, { useEffect, useState } from "react";
import Categories from "./Categories";
import SubCategories from "./SubCategories";
import { Category } from "types/products";

const ProductMenuHeader = ({ categories }: { categories: Category[] }) => {
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(
    null
  );
  useEffect(() => {
    {
      if (categories.length !== 0) setSelectedCategory(categories[0]);
    }
  }, [categories]);

  if (selectedCategory === null) {
    return null;
  }

  return (
    <motion.div className="absolute w-full left-0 z-40 ">
      <motion.div
        className="  backdrop-blur-3xl  py-16 px-10 xl:px-28  w-full z-30"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
        exit={{ opacity: 0, y: -50, transition: { duration: 0.2 } }}
      >
        <div className="wrapper flex   ">
          <Categories
            categories={categories}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
          />

          <SubCategories subCategories={selectedCategory.subCategories} />
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ProductMenuHeader;
