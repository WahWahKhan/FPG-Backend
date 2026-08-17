import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { Category, SubCategory } from "types/products";

const HeaderProducts = ({
  categories,
  slug,
}: {
  categories: Category[];
  slug: string | string[] | undefined;
}) => {
  const { subcategory } = useRouter().query;

  const subCategories = useMemo(
    () =>
      categories.reduce(
        (prev: SubCategory[], curr) => prev.concat(curr.subCategories),
        []
      ),
    [categories]
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <h1 className="text-4xl font-semibold">Products</h1>
      <h2 className="text-xl font-light text-center">
        {subCategories.find((c) => subcategory === c.slug)?.description}
      </h2>
    </div>
  );
};

export default HeaderProducts;
