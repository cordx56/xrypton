import { useState } from "react";
import { z } from "zod";
import { useContexts, getContacts, saveContacts } from "@/utils/context";
import { Contacts } from "@/utils/schema";
import { DialogComponent } from "@/utils/dialogs";
import CommonDialog from "@/components/Dialogs/CommonDialog";
import QrReader from "@/components/QrReader";

const AddContact: DialogComponent<{
  add: (keyId: string, name: string, keys: string) => void;
}> = ({ close, setOnClose, add }) => {
  const { worker } = useContexts();

  const [name, setName] = useState("");
  const [keyId, setKeyId] = useState("");
  const [pubKey, setPubKey] = useState<string | null>(null);
  const checkPubkey = (publicKeys: string) => {
    worker?.eventWaiter("get_key_id", (data) => {
      console.log(data);
      if (data.success) {
        setPubKey(publicKeys);
        setKeyId(data.data.key_id);
      }
    });
    worker?.postMessage({ call: "get_key_id", publicKeys });
  };

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
                add(keyId, name, pubKey);
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
          <QrReader setData={checkPubkey}></QrReader>
          <p className="p">Or paste public key</p>
          <textarea
            className="input-text"
            onChange={(e) => checkPubkey(e.target.value)}
          />
        </div>
      )}
    </CommonDialog>
  );
};

const ContactsList = ({
  select,
}: {
  select: (keyId: string, name: string, keys: string) => void;
}) => {
  const { dialogs } = useContexts();

  const [contacts, setContacts] =
    useState<z.infer<typeof Contacts>>(getContacts());
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
        {Object.entries(contacts)
          .filter(
            ([_key, data]) => search.length === 0 || data.name.includes(search),
          )
          .map(([key, data]) => (
            <li
              key={key}
              className={`default-border border-b p-2 ${selected.includes(key) ? "selected" : ""}`}
              onClick={() => setSelected([key])}
            >
              {data.name}
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
                add={(keyId, name, publicKeys) => {
                  setContacts((v) => {
                    v[keyId] = { name, publicKeys };
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
          onClick={() =>
            select(
              selected[0],
              contacts[selected[0]].name,
              contacts[selected[0]].publicKeys,
            )
          }
        >
          OK
        </button>
      </div>
    </div>
  );
};

export default ContactsList;
