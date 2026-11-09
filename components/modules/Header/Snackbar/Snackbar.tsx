import siteLinks from "constants/site-links";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { FiMenu } from "react-icons/fi";
import { useLockBodyScroll } from "react-use";
import NavSnackbar from "./NavSnackbar";

const Snackbar = () => {
  const [menu, setMenu] = useState(false);
  const variants = {
    initial: { opacity: 0, y: -100 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, staggerChildren: 0.5 },
    },
    exit: { opacity: 0, y: -100, transition: { duration: 0.3 } },
  };

  useLockBodyScroll(menu);

  return (
    <div className="text-3xl  icon-btn ">
      <FiMenu
        onClick={() => {
          setMenu(!menu);
        }}
      />
      <AnimatePresence mode="wait">
        {menu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: 0.8 },
              }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              className="fixed mt-6 left-0 w-full h-screen -z-10 bg-black/10"
              onClick={() => setMenu(!menu)}
            ></motion.div>
            <motion.div
              className="absolute  left-0 mt-6 w-full p-8 -z-10  bg-white border-b"
              variants={variants}
              initial={"initial"}
              animate={"animate"}
              exit={"exit"}
            >
              <NavSnackbar
                handleClose={() => {
                  setMenu(false);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Snackbar;
