import clsx from "clsx";
import siteLinks from "constants/site-links";
import { HoverContext } from "context/HoverWrapper";
import React, { useContext, useMemo } from "react";

const NavHeader = () => {
  const { hover, setHover } = useContext(HoverContext);

  const pages = useMemo(
    () => siteLinks.map((page) => ({ ...page, id: page.href /* unique per link; stable key (was a random uuid) */ })),
    []
  );

  return (
    <div className="flex items-center gap-2">
      {pages.map((page) => (
        <div
          onMouseEnter={() =>
            page.title !== "About" &&
            page.title !== "Contact" &&
            setHover(page.title)
          }
          key={page.id}
        >
          <a
            href={page.href}
            className={clsx(
              "text-lg capitalize hover:no-underline py-3 px-3 rounded-lg hover:text-yellow-400  font-medium whitespace-pre"
            )}
          >
            {page.title}
          </a>
        </div>
      ))}
    </div>
  );
};

export default NavHeader;
