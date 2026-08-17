import withLayout from "@/hoc/withLayout";
import { FilterProducts, GridProducts, HeaderProducts } from "@/views/Products";
import { useEffect, useState } from "react";
import Header from "@/modules/Header";
import { useRouter } from "next/router";
import axios from "axios";
import Loading from "@/modules/Loading";
import { AnimatePresence, motion } from "framer-motion";

type searchParams = {
  title: string | null;
  categories: string | null;
  subCategories: string | null;
  extraParams?: string | null;
};

const SEARCHPARAMETERS = [
  {
    product: "Hose Fittings",
    categories: ["BSP", "JIC", "METRIC", "ORFS", "FERRULES"],
    subCategories: [
      " Male Straight",
      "Female Straight",
      "45\u00B0",
      "90\u00B0",
      "Banjo",
    ],
  },
  {
    product: "Hydraulic Adaptors",
    categories: ["BSP", "JIC", "METRIC", "ORFS", "STAINLESS ADAPTORS"],
    subCategories: ["Straight", "45\u00B0", "90\u00B0", "TEE"],
  },
  {
    product: "Hydraulic Hoses",
    categories: ["Suction", "Hydraulic"],
    subCategories: [],
  },
  {
    product: "Steel Tubes",
    categories: ["Carbon Steel", "Stainless Steel"],
    subCategories: ["Metric", "Imperial"],
  },
  {
    product: "Miscellaneous",
    categories: ["Tube Clamps", "Quick Release Couplers", "Ball Valves", "Hose Protections", "Hydraulic Valves"],
    subCategories: [],
  }
];

const Search = () => {
  const router = useRouter();
  const [titles, setTitles] = useState<String>("");
  const [categories, setCategories] = useState<searchParams>({title: null, categories: null, subCategories: null, extraParams: null});
  const [data, setData] = useState<any>([]);
  const [filteredData, setFilteredData] = useState<any>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(false);
  const [open, setOpen] = useState<String>("");

  useEffect(() => {
    const categories = async () => {
      const cat = await axios.get(
        `${process.env.NEXT_PUBLIC_BASEURL}/getAllProducts`
      );
      if (cat.data.categories.length !== 0) {
        if (cat.data.categories[0].subCategories.length !== 0) {
          if (cat.data.categories[0].subCategories[0].series.length !== 0) {
            return cat;
          } else {
            await categories();
          }
        } else {
          await categories();
        }
      } else {
        await categories();
      }
    };

    categories().then((result: any) => {
      if (result === undefined) {
        setRetry(true);
        return;
      }
      setData(result.data.categories);
      setLoading(false);
    });
  }, [retry]);

  // useEffect(() => {
  //       const series = async () => {
  //     const series = await axios.post(
  //       `${process.env.NEXT_PUBLIC_BASEURL}/getAllSeries`,
  //       { data: { slug } }
  //     );
  //     return series;
  //   };

  //   series().then((result: any) => {
  //     setSeries(result.data.series);
  //   });
  // }, [slug]);

  // const checkCategory = (product: string, category: string) => {
  //   const found = categories.find((cat) => cat.title === product);
  //   if (found) {
  //     return found.categories.includes(category);
  //   }
  //   return false;
  // };

  // const checkSubCategory = (product: string, subCategory: string) => {
  //   const found = categories.find((cat) => cat.title === product);
  //   if (found) {
  //     return found.subCategories.includes(subCategory);
  //   }
  //   return false;
  // };

  // const addCategory = (product: string, category: string) => {
  //   const found = categories.find((cat) => cat.title === product);
  //   if (found) {
  //     if (found.categories.includes(category)) {
  //       found.categories = found.categories.filter((cat) => cat !== category);
  //     } else {
  //       found.categories.push(category);
  //     }
  //   } else {
  //     categories.push({
  //       title: product,
  //       categories: [category],
  //       subCategories: [],
  //     });
  //   }
  //   setCategories([...categories]);
  // };

  // const addSubCategory = (product: string, subCategory: string) => {
  //   const found = categories.find((cat) => cat.title === product);
  //   if (found) {
  //     if (found.subCategories.includes(subCategory)) {
  //       found.subCategories = found.subCategories.filter(
  //         (cat) => cat !== subCategory
  //       );
  //     } else {
  //       found.subCategories.push(subCategory);
  //     }
  //   } else {
  //     categories.push({
  //       title: product,
  //       categories: [],
  //       subCategories: [subCategory],
  //     });
  //   }
  //   setCategories([...categories]);
  // };

  useEffect(() => {
    let newFilteredData: any[] = [];

    if (categories.title !== null && categories.categories !== null) {
      data.forEach((product: any) => {
        if (product.title === categories.title) {
          console.log(product.subCategories)
          product.subCategories.forEach((cat: any) => {
            if (cat.title.toLowerCase() === categories.categories?.toLowerCase()) {
              newFilteredData = [...newFilteredData, ...cat.series];
              if (categories.subCategories)
                newFilteredData = newFilteredData.filter(series => series.description?.toLowerCase().includes(categories.subCategories?.replace("\u00B0", '').toLowerCase()))
            }
          })
        }
      });
    }
    
    setFilteredData(newFilteredData)
  }, [categories, data]);

  const variants = {
    initial: { opacity: 0, x: -100 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.5, staggerChildren: 0.5 },
    },
    exit: { opacity: 0, y: -100, transition: { duration: 0.3 } },
  };

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="px-8 md:px-12 py-12 min-h-screen">
      <div className="text-[4rem] md:text-[6rem] lg:text-[8rem] xl:text-[10rem] font-bold text-slate-200/50 md:mx-10 ">
        Search
      </div>
      <div className="wrapper flex flex-col gap-12 items-center px-10">
        <div className="w-full p-5 px-8 rounded-md shadow-lg hover:shadow-xl transition duration-200">
          <div>
            <div>
              {SEARCHPARAMETERS.map((product, index) => (
                <div
                  key={index}
                  className="flex flex-col md:flex-row justify-start items-start my-2"
                >
                  <div
                    className="w-[30%] max-w-[200px]"
                    onClick={() => {
                      setTitles(product.product);
                      setCategories({
                        title: product.product,
                        categories: null,
                        subCategories: null,
                        extraParams: null,
                      });
                      setOpen(product.product);
                    }}
                  >
                    <span
                      className={`text-lg font-bold ${
                        open === product.product
                          ? "text-primary"
                          : "text-slate-700"
                      } cursor-pointer`}
                    >
                      {product.product}
                    </span>
                  </div>
                  {open === product.product && (
                    <AnimatePresence>
                      <div>
                        <motion.div
                          variants={variants}
                          initial={"initial"}
                          animate={"animate"}
                          exit={"exit"}
                          transition={{ duration: 0.5, staggerChildren: 0.5 }}
                        >
                          <div>
                            <span className="text-md font-bold text-black">
                              Categories
                            </span>
                            <motion.div className="flex mt-2 flex-wrap">
                              {product.categories.map((category, index) => (
                                <div
                                  className={`border-2 rounded-xl mr-4 px-4 py-1 flex justify-center items-center my-2 hover:cursor-pointer
                                  ${
                                    categories.categories === category
                                      ? "border-slate-700 text-slate-700 bg-primary"
                                      : "border-slate-700"
                                  }
                                  `}
                                  key={index}
                                  onClick={() => {
                                    setCategories({
                                      ...categories,
                                      categories: category,
                                    })
                                  }}
                                >
                                  {category}
                                </div>
                              ))}
                            </motion.div>
                          </div>
                          <div className="mt-2">
                            <span className="text-md font-bold text-black">
                              {product.subCategories.length > 0 &&
                                "Sub-Categories"}
                            </span>
                            <div className="flex mt-2 flex-wrap mb-5">
                              {product.subCategories.map(
                                (subCategory, index) => (
                                  <div
                                    className={`
                                  border-2 rounded-xl mr-4 mt-2 px-4 py-1 flex justify-center items-center hover:cursor-pointer
                                  ${
                                      categories.subCategories === subCategory
                                      ? "border-slate-700 text-slate-700 bg-primary"
                                      : "border-slate-700"
                                  }
                                  `}
                                    key={index}
                                    onClick={() => {
                                      setCategories({
                                        ...categories,
                                        subCategories: subCategory,
                                      })
                                    }}
                                  >
                                    {subCategory}
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    </AnimatePresence>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <motion.div className="p-10">
        <GridProducts
          seriesList={filteredData}
          showDescription={Boolean(false)}
        />
      </motion.div>
    </div>
  );
};

export default Search;
