import { useState } from "react";
import { useContexts } from "@/utils/context";
import { DialogComponent } from "@/utils/dialogs";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import QrReader from "@/components/QrReader";

const AddContact: DialogComponent<{
  add: (name: string, keys: string) => void;
}> = ({ close, setOnClose, add }) => {
  const [name, setName] = useState("");
  const [pubKey, setPubKey] = useState<string | null>(null);

  return (
    <CommonDialog close={close} setOnClose={setOnClose}>
      {pubKey ? (
        <div>
          <p className="p">Contact name</p>
          <p className="p">
            <input
              type="text"
              className="input-text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </p>
          <p className="p">
            <button
              type="button"
              className="button"
              disabled={name.length === 0}
              onClick={() => {
                add(name, pubKey);
                close();
              }}
            >
              Save
            </button>
          </p>
        </div>
      ) : (
        <div className="text-center">
          <p className="p">Read public key QR</p>
          <QrReader setData={setPubKey}></QrReader>
        </div>
      )}
    </CommonDialog>
  );
};

const Contacts = ({
  select,
}: {
  select: (name: string, keys: string) => void;
}) => {
  const { dialogs } = useContexts();

  const [contacts, setContacts] = useState<Record<string, string>>(
    JSON.parse(localStorage.getItem("contacts") ?? "{}"),
  );
  const saveContacts = (contacts: Record<string, string>) => {
    localStorage.setItem("contacts", JSON.stringify(contacts));
  };
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <div>
      <div className="m-2">
        <input
          type="text"
          className="input-text"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ul className="m-2 border default-border">
        {Object.keys(contacts)
          .filter((v) => search.length === 0 || v.includes(search))
          .map((v, i) => (
            <li
              key={i}
              className={`default-border border-b p-2 ${selected.includes(v) ? "selected" : ""}`}
              onClick={() => setSelected([v])}
            >
              {v}
            </li>
          ))}
      </ul>
      <div className="m-2 text-center">
        <button
          type="button"
          className="button m-2"
          onClick={() =>
            dialogs?.pushDialog((p) => (
              <AddContact
                {...p}
                add={(name, keys) => {
                  setContacts((v) => {
                    v[name] = keys;
                    saveContacts(v);
                    return v;
                  });
                }}
              />
            ))
          }
        >
          New
        </button>
        <button
          type="button"
          className="button m-2"
          disabled={selected.length === 0}
          onClick={() => {
            setContacts((v) => {
              for (const name of selected) {
                delete v[name];
              }
              saveContacts(v);
              setSelected([]);
              return v;
            });
          }}
        >
          Delete
        </button>
        <button
          type="button"
          className="button m-2"
          disabled={selected.length !== 1}
          onClick={() => select(selected[0], contacts[selected[0]])}
        >
          OK
        </button>
      </div>
    </div>
  );
};

export default Contacts;
