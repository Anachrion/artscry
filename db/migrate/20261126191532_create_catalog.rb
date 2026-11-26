class CreateCatalog < ActiveRecord::Migration[8.1]
  def change
    # Magic sets, imported from Scryfall's /sets endpoint.
    create_table :card_sets do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :set_type
      t.date :released_at
      t.string :icon_svg_uri
      t.string :parent_set_code
      t.boolean :digital, null: false, default: false
      t.integer :illustration_count, null: false, default: 0
      t.timestamps
    end
    add_index :card_sets, :code, unique: true

    # Which illustration appears in which set (one row per distinct artwork per set),
    # imported from Scryfall's "default cards" bulk file.
    create_table :printings do |t|
      t.string :set_code, null: false
      t.string :illustration_id, null: false
    end
    add_index :printings, [ :set_code, :illustration_id ], unique: true
    add_index :printings, :illustration_id
  end
end
