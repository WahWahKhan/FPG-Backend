import Anchor from "@/modules/Anchor";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import React from "react";
import { SubCategory } from "types/products";

type ICategoriesProps = {
  subCategories: SubCategory[];
};

const SubCategories = ({ subCategories }: ICategoriesProps) => {
  if (subCategories === null || subCategories.length === 0) {
    return null
  }
  return (
    <div className="grid grid-rows-3 grid-cols-3  w-4/5 grid-flow-col gap-y-6 gap-x-6 pl-12 xl:pl-20 ">
      <AnimatePresence mode="wait">
        {subCategories.map((subCategory) => (
          <Anchor
            key={subCategory.id}
            href={`/products?subcategory=${subCategory?.slug}`}
            className="hover:no-underline"
          >
            <motion.div
              key={subCategory?.id}
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 50, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full h-full flex   rounded-lg group cursor-pointer "
            >
              <div className=" group-hover:scale-105 transition-all  duration-200 rounded-xl w-20 h-20 p-2  border">
                <div className="relative  w-full h-full   ">
                  <Image
                    src={subCategory?.image || "/product-3.png"}
                    fill style={{ objectFit: "contain" }}
                    alt="Site logo"
                  />
                </div>
              </div>
              <h3 className="text-lg xl:text-xl group-hover:underline underline-offset-4  font-light py-1 px-4">
                {subCategory?.title}
              </h3>
            </motion.div>
          </Anchor>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default SubCategories;
