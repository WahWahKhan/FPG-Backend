import Anchor from "@/modules/Anchor";
import siteLinks from "constants/site-links";
import { motion } from "framer-motion";
import { useMemo } from "react";

type INavSnackbarProps = { handleClose: () => void };

const NavSnackbar = ({ handleClose }: INavSnackbarProps) => {
  const pages = useMemo(
    () => siteLinks.map((page) => ({ ...page, id: page.href /* unique per link; stable key (was a random uuid) */ })),
    []
  );

  return (
    <div className="flex flex-col gap-4 text-3xl font-light    tracking-wider text-black ">
      {pages.map((page, i) => (
        <motion.div
          key={page.id}
          initial={{ opacity: 0, y: -100 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.6, delay: i * 0.2 },
          }}
          exit={{
            opacity: 0,
            y: -100,
            transition: {
              duration: 0.2,
            },
          }}
          onClick={handleClose}
        >
          <Anchor href={page.href} className="flex items-center gap-4">
            {page.title}
          </Anchor>
        </motion.div>
      ))}
    </div>
  );
};

export default NavSnackbar;
